#pragma once
#include <map>
#include <mutex>
#include <string>
#include "storage/aws_sigv4.h"
#include "storage/storage_backend.h"

namespace storage {

// Configuration for the S3-compatible backend.
struct S3Config {
  std::string endpoint;  // e.g. "http://minio:9000" or "https://s3.us-east-1.amazonaws.com"
  std::string bucket;    // bucket name
  std::string access_key;
  std::string secret_key;
  std::string region = "us-east-1";
  // Path-style addressing (http://endpoint/bucket/key) vs virtual-host style
  // (http://bucket.endpoint/key). MinIO/Ceph/self-hosted default to path-style;
  // AWS prefers virtual-host. Default true (path-style) for self-hosting.
  bool use_path_style = true;
};

// S3-compatible object storage backend. Talks the S3 REST API (SigV4-signed)
// over cpp-httplib, so it works with MinIO, Garage, Ceph RGW, OpenStack Swift
// (s3api), AWS S3, Cloudflare R2, Backblaze B2, etc. Enables shared storage
// across horizontally-scaled instances.
//
// The multipart API is stateless: the S3 upload id and per-part ETags travel in
// the caller-supplied MultipartState (persisted in the upload_sessions DB row by
// UploadManager), so a chunked upload's create/put/complete requests can be
// served by different instances with no per-process state and no session
// affinity. This class only speaks the S3 wire protocol.
class S3Backend : public StorageBackend {
public:
  explicit S3Backend(S3Config config);

  bool put(const std::string& key, std::string_view bytes) override;
  GetResult get(const std::string& key) override;
  bool exists(const std::string& key) override;
  void remove(const std::string& key) override;

  bool create_multipart(const std::string& upload_id, MultipartState& st) override;
  std::string put_part(
    const std::string& upload_id,
    const MultipartState& st,
    int index,
    std::string_view bytes,
    const std::string& expected_sha256_hex,
    std::string& token_out) override;
  int64_t complete_multipart(
    const std::string& upload_id, const MultipartState& st, const std::string& final_key) override;
  void abort_multipart(const std::string& upload_id, const MultipartState& st) override;

  // Lightweight connectivity check (HEAD the bucket). Returns true if reachable
  // and authorized. Used at startup to fail fast on misconfiguration.
  bool health_check();

private:
  // Build the canonical URI (path) for a key, including the bucket in path-style.
  std::string uri_for_key(const std::string& key) const;
  // host header value derived from the endpoint.
  std::string host() const;
  // scheme + host[:port] base for httplib::Client.
  std::string client_base() const;

  // Perform a signed request. Returns {status, body}. status 0 means the request
  // could not be sent (connection error).
  struct Response {
    int status = 0;
    std::string body;
    std::map<std::string, std::string> headers;
  };
  Response signed_request(
    const std::string& method,
    const std::string& canonical_uri,
    const std::string& canonical_query,
    std::string_view payload,
    const std::map<std::string, std::string>& extra_headers = {});

  S3Config config_;
  sigv4::Credentials creds_;
  std::string scheme_;  // "http" or "https"
  std::string host_;    // host[:port]
};

}  // namespace storage
