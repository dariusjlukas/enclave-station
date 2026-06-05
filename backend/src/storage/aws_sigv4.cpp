#include "storage/aws_sigv4.h"

#include <openssl/hmac.h>
#include <openssl/sha.h>
#include <algorithm>
#include <cctype>
#include <cstdio>
#include <sstream>

namespace storage::sigv4 {

std::string sha256_hex(std::string_view data) {
  unsigned char h[SHA256_DIGEST_LENGTH];
  SHA256(reinterpret_cast<const unsigned char*>(data.data()), data.size(), h);
  static const char* hex = "0123456789abcdef";
  std::string out;
  out.reserve(SHA256_DIGEST_LENGTH * 2);
  for (unsigned char c : h) {
    out.push_back(hex[c >> 4]);
    out.push_back(hex[c & 0xf]);
  }
  return out;
}

std::string hmac_sha256(std::string_view key, std::string_view data) {
  unsigned char out[EVP_MAX_MD_SIZE];
  unsigned int len = 0;
  HMAC(
    EVP_sha256(),
    key.data(),
    static_cast<int>(key.size()),
    reinterpret_cast<const unsigned char*>(data.data()),
    data.size(),
    out,
    &len);
  return std::string(reinterpret_cast<char*>(out), len);
}

static std::string to_hex(std::string_view raw) {
  static const char* hex = "0123456789abcdef";
  std::string out;
  out.reserve(raw.size() * 2);
  for (unsigned char c : raw) {
    out.push_back(hex[c >> 4]);
    out.push_back(hex[c & 0xf]);
  }
  return out;
}

std::string uri_encode(std::string_view s, bool keep_slash) {
  std::string out;
  out.reserve(s.size() * 3);
  for (unsigned char c : s) {
    bool unreserved = (std::isalnum(c) != 0) || c == '-' || c == '_' || c == '.' || c == '~';
    if (unreserved || (keep_slash && c == '/')) {
      out.push_back(static_cast<char>(c));
    } else {
      char buf[4];
      std::snprintf(buf, sizeof(buf), "%%%02X", c);
      out += buf;
    }
  }
  return out;
}

std::map<std::string, std::string> sign(const Credentials& creds, const Request& req) {
  std::string payload_hash = sha256_hex(req.payload);

  // 1. Canonical headers. We always sign host, x-amz-content-sha256, x-amz-date,
  //    plus any extra headers (lowercased), sorted by name.
  std::map<std::string, std::string> headers;
  headers["host"] = req.host;
  headers["x-amz-content-sha256"] = payload_hash;
  headers["x-amz-date"] = req.amz_date;
  for (const auto& [k, v] : req.extra_headers) {
    headers[k] = v;
  }

  std::string canonical_headers;
  std::string signed_headers;
  bool first = true;
  for (const auto& [k, v] : headers) {  // std::map iterates sorted by key
    canonical_headers += k;
    canonical_headers += ":";
    canonical_headers += v;
    canonical_headers += "\n";
    if (!first) signed_headers += ";";
    signed_headers += k;
    first = false;
  }

  // 2. Canonical request.
  std::string canonical_request = req.method + "\n" + req.canonical_uri + "\n" +
                                  req.canonical_query + "\n" + canonical_headers + "\n" +
                                  signed_headers + "\n" + payload_hash;

  // 3. String to sign.
  std::string scope = req.datestamp + "/" + creds.region + "/" + creds.service + "/aws4_request";
  std::string string_to_sign =
    "AWS4-HMAC-SHA256\n" + req.amz_date + "\n" + scope + "\n" + sha256_hex(canonical_request);

  // 4. Signing key (HMAC chain).
  std::string k_date = hmac_sha256("AWS4" + creds.secret_key, req.datestamp);
  std::string k_region = hmac_sha256(k_date, creds.region);
  std::string k_service = hmac_sha256(k_region, creds.service);
  std::string k_signing = hmac_sha256(k_service, "aws4_request");

  // 5. Signature.
  std::string signature = to_hex(hmac_sha256(k_signing, string_to_sign));

  std::string authorization = "AWS4-HMAC-SHA256 Credential=" + creds.access_key + "/" + scope +
                              ", SignedHeaders=" + signed_headers + ", Signature=" + signature;

  std::map<std::string, std::string> out = headers;
  out["authorization"] = authorization;
  return out;
}

}  // namespace storage::sigv4
