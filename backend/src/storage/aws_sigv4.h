#pragma once
#include <map>
#include <string>

// Minimal AWS Signature Version 4 signer for S3 REST requests, implemented with
// OpenSSL (no aws-sdk dependency). Works against any S3-compatible endpoint
// (MinIO, Garage, Ceph RGW, OpenStack Swift s3api, AWS, R2, B2, ...).
//
// Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
namespace storage::sigv4 {

struct Credentials {
  std::string access_key;
  std::string secret_key;
  std::string region;  // e.g. "us-east-1" (MinIO accepts any value)
  std::string service = "s3";
};

// Inputs for signing a single request.
struct Request {
  std::string method;           // "GET", "PUT", "DELETE", "POST", "HEAD"
  std::string host;             // Host header value, e.g. "minio:9000"
  std::string canonical_uri;    // path, percent-encoded per S3 rules, e.g. "/bucket/key"
  std::string canonical_query;  // already-encoded & sorted query string ("" if none)
  std::string payload;          // request body (may be empty)
  std::string amz_date;         // "YYYYMMDDTHHMMSSZ"
  std::string datestamp;        // "YYYYMMDD"
  std::map<std::string, std::string> extra_headers;  // lowercased header name -> value (optional)
};

// SHA-256 hex digest of `data`.
std::string sha256_hex(std::string_view data);

// HMAC-SHA256(key, data) raw bytes.
std::string hmac_sha256(std::string_view key, std::string_view data);

// Compute the headers that must be added to the request to authenticate it:
// returns a map containing at least "authorization", "x-amz-date", and
// "x-amz-content-sha256". The caller merges these into the HTTP request.
std::map<std::string, std::string> sign(const Credentials& creds, const Request& req);

// Percent-encode a path segment / key per S3 rules (unreserved chars kept, '/'
// preserved when is_path=true). Exposed for building canonical_uri.
std::string uri_encode(std::string_view s, bool keep_slash);

}  // namespace storage::sigv4
