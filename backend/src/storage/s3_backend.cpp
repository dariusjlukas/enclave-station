#include "storage/s3_backend.h"

#include <httplib.h>
#include <cctype>
#include <ctime>
#include <sstream>
#include "logging/logger.h"

namespace storage {

namespace {
// Current UTC time as the two SigV4 timestamp formats.
void utc_now(std::string& amz_date, std::string& datestamp) {
  std::time_t t = std::time(nullptr);
  std::tm tm{};
  gmtime_r(&t, &tm);
  char buf[32];
  std::strftime(buf, sizeof(buf), "%Y%m%dT%H%M%SZ", &tm);
  amz_date = buf;
  std::strftime(buf, sizeof(buf), "%Y%m%d", &tm);
  datestamp = buf;
}

// Extract <UploadId> / <ETag> from a tiny S3 XML response without a full parser.
std::string xml_tag(const std::string& body, const std::string& tag) {
  auto open = "<" + tag + ">";
  auto close = "</" + tag + ">";
  auto a = body.find(open);
  if (a == std::string::npos) return "";
  a += open.size();
  auto b = body.find(close, a);
  if (b == std::string::npos) return "";
  return body.substr(a, b - a);
}
}  // namespace

S3Backend::S3Backend(S3Config config) : config_(std::move(config)) {
  creds_.access_key = config_.access_key;
  creds_.secret_key = config_.secret_key;
  creds_.region = config_.region;
  creds_.service = "s3";

  // Split endpoint into scheme + host[:port].
  std::string ep = config_.endpoint;
  auto pos = ep.find("://");
  if (pos != std::string::npos) {
    scheme_ = ep.substr(0, pos);
    host_ = ep.substr(pos + 3);
  } else {
    scheme_ = "http";
    host_ = ep;
  }
  while (!host_.empty() && host_.back() == '/') host_.pop_back();
}

std::string S3Backend::host() const {
  return host_;
}

std::string S3Backend::client_base() const {
  return scheme_ + "://" + host_;
}

std::string S3Backend::uri_for_key(const std::string& key) const {
  // Path-style: /bucket/key. (Virtual-host style would move the bucket into the
  // host; path-style is the self-hosting default and what MinIO/Ceph use.)
  return "/" + config_.bucket + "/" + sigv4::uri_encode(key, /*keep_slash=*/true);
}

S3Backend::Response S3Backend::signed_request(
  const std::string& method,
  const std::string& canonical_uri,
  const std::string& canonical_query,
  std::string_view payload,
  const std::map<std::string, std::string>& extra_headers) {
  std::string amz_date, datestamp;
  utc_now(amz_date, datestamp);

  sigv4::Request sreq;
  sreq.method = method;
  sreq.host = host_;
  sreq.canonical_uri = canonical_uri;
  sreq.canonical_query = canonical_query;
  sreq.payload = std::string(payload);
  sreq.amz_date = amz_date;
  sreq.datestamp = datestamp;
  sreq.extra_headers = extra_headers;

  auto signed_headers = sigv4::sign(creds_, sreq);

  httplib::Client cli(client_base());
  cli.set_connection_timeout(5);
  cli.set_read_timeout(120);
  cli.set_write_timeout(120);

  httplib::Request hreq;
  hreq.method = method;
  hreq.path = canonical_uri + (canonical_query.empty() ? "" : "?" + canonical_query);
  for (const auto& [k, v] : signed_headers) {
    hreq.set_header(k, v);
  }
  if (!payload.empty() || method == "PUT" || method == "POST") {
    hreq.body = std::string(payload);
  }

  Response out;
  auto res = cli.send(hreq);
  if (!res) {
    out.status = 0;
    LOG_WARN_N("s3", nullptr, "S3 request failed: " + httplib::to_string(res.error()));
    return out;
  }
  out.status = res->status;
  out.body = res->body;
  for (const auto& [k, v] : res->headers) {
    std::string lk = k;
    for (char& c : lk) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    out.headers[lk] = v;
  }
  return out;
}

bool S3Backend::put(const std::string& key, std::string_view bytes) {
  auto r = signed_request("PUT", uri_for_key(key), "", bytes);
  if (r.status != 200) {
    LOG_WARN_N("s3", nullptr, "PutObject " + key + " -> HTTP " + std::to_string(r.status));
    return false;
  }
  return true;
}

GetResult S3Backend::get(const std::string& key) {
  auto r = signed_request("GET", uri_for_key(key), "", "");
  if (r.status == 200) {
    return {true, std::move(r.body)};
  }
  return {false, {}};
}

bool S3Backend::exists(const std::string& key) {
  auto r = signed_request("HEAD", uri_for_key(key), "", "");
  return r.status == 200;
}

void S3Backend::remove(const std::string& key) {
  // S3 DeleteObject returns 204 on success and is idempotent (also 204 if absent).
  signed_request("DELETE", uri_for_key(key), "", "");
}

bool S3Backend::health_check() {
  // HEAD the bucket root.
  auto r = signed_request("HEAD", "/" + config_.bucket + "/", "", "");
  return r.status == 200 || r.status == 403 || r.status == 404;
}

namespace {
// The staging object key for a multipart upload is derived from upload_id, so
// no in-process state is needed to locate it across instances.
std::string staging_key_for(const std::string& upload_id) {
  return "multipart/" + upload_id;
}
}  // namespace

bool S3Backend::create_multipart(const std::string& upload_id, MultipartState& st) {
  // Stage parts under a temporary key, then CompleteMultipartUpload assembles
  // them there, and complete_multipart copies to the final key.
  std::string staging_key = staging_key_for(upload_id);
  auto r = signed_request("POST", uri_for_key(staging_key), "uploads=", "");
  if (r.status != 200) {
    LOG_WARN_N(
      "s3", nullptr, "CreateMultipartUpload -> HTTP " + std::to_string(r.status) + ": " + r.body);
    return false;
  }
  std::string s3_upload_id = xml_tag(r.body, "UploadId");
  if (s3_upload_id.empty()) return false;
  st.handle = s3_upload_id;  // persisted by the caller (DB) and passed back
  return true;
}

std::string S3Backend::put_part(
  const std::string& upload_id,
  const MultipartState& st,
  int index,
  std::string_view bytes,
  const std::string& expected_sha256_hex,
  std::string& token_out) {
  if (index < 0 || index >= st.chunk_count) return "invalid_index";
  if (!expected_sha256_hex.empty()) {
    if (sigv4::sha256_hex(bytes) != expected_sha256_hex) return "hash_mismatch";
  }

  // S3 part numbers are 1-based.
  int part_number = index + 1;
  std::string query = "partNumber=" + std::to_string(part_number) +
                      "&uploadId=" + sigv4::uri_encode(st.handle, false);
  auto r = signed_request("PUT", uri_for_key(staging_key_for(upload_id)), query, bytes);
  if (r.status != 200) {
    LOG_WARN_N("s3", nullptr, "UploadPart -> HTTP " + std::to_string(r.status));
    return "io_error";
  }
  // The ETag is the part token the caller persists and passes to complete.
  token_out = r.headers.count("etag") ? r.headers["etag"] : "";
  return "";
}

int64_t S3Backend::complete_multipart(
  const std::string& upload_id, const MultipartState& st, const std::string& final_key) {
  std::string staging_key = staging_key_for(upload_id);

  // Build the CompleteMultipartUpload XML body from the caller-supplied part
  // tokens (0-based index -> ETag); S3 part numbers are 1-based and ordered.
  std::ostringstream xml;
  xml << "<CompleteMultipartUpload>";
  for (const auto& [index, etag] : st.part_tokens) {
    std::string e = etag;
    if (e.empty() || e.front() != '"') {
      e.insert(e.begin(), '"');
      e.push_back('"');
    }
    xml << "<Part><PartNumber>" << (index + 1) << "</PartNumber><ETag>" << e << "</ETag></Part>";
  }
  xml << "</CompleteMultipartUpload>";

  std::string query = "uploadId=" + sigv4::uri_encode(st.handle, false);
  auto r = signed_request("POST", uri_for_key(staging_key), query, xml.str());
  bool ok = (r.status == 200) && r.body.find("<Error>") == std::string::npos;
  if (!ok) {
    LOG_WARN_N(
      "s3", nullptr, "CompleteMultipartUpload -> HTTP " + std::to_string(r.status) + ": " + r.body);
    abort_multipart(upload_id, st);
    return -1;
  }

  // The staged object now lives at `staging_key`; copy it to the final key so
  // downloads (which use the final key) find it, then delete the staging object.
  std::string copy_source =
    "/" + config_.bucket + "/" + sigv4::uri_encode(staging_key, /*keep_slash=*/true);
  auto cp =
    signed_request("PUT", uri_for_key(final_key), "", "", {{"x-amz-copy-source", copy_source}});
  if (cp.status != 200) {
    LOG_WARN_N(
      "s3", nullptr, "CopyObject (multipart finalize) -> HTTP " + std::to_string(cp.status));
    return -1;
  }
  signed_request("DELETE", uri_for_key(staging_key), "", "");  // best-effort
  return st.total_size;
}

void S3Backend::abort_multipart(const std::string& upload_id, const MultipartState& st) {
  if (st.handle.empty()) return;
  std::string query = "uploadId=" + sigv4::uri_encode(st.handle, false);
  signed_request("DELETE", uri_for_key(staging_key_for(upload_id)), query, "");
}

}  // namespace storage
