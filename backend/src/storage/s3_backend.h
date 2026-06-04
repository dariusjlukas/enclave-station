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
// Multipart state (the S3 upload id + per-part ETags) is held per-process here;
// for chunked uploads to span instances the staging must stick to one instance
// OR this state must move to a shared store. The DB-backed multipart map is
// layered on top in a follow-up; this class keeps the S3 wire protocol.
class S3Backend : public StorageBackend {
public:
  explicit S3Backend(S3Config config);

  bool put(const std::string& key, std::string_view bytes) override;
  GetResult get(const std::string& key) override;
  bool exists(const std::string& key) override;
  void remove(const std::string& key) override;

  bool create_multipart(
    const std::string& upload_id, int64_t total_size, int chunk_count, int64_t chunk_size) override;
  std::string put_part(
    const std::string& upload_id,
    int index,
    std::string_view bytes,
    const std::string& expected_sha256_hex) override;
  int multipart_received(const std::string& upload_id) override;
  int64_t complete_multipart(const std::string& upload_id, const std::string& final_key) override;
  void abort_multipart(const std::string& upload_id) override;
  void cleanup_stale_multipart(int max_age_seconds) override;

  // Lightweight connectivity check (HEAD the bucket). Returns true if reachable
  // and authorized. Used at startup to fail fast on misconfiguration.
  bool health_check();

private:
  struct Multipart {
    std::string s3_upload_id;
    std::string final_key_hint;
    int64_t total_size = 0;
    int chunk_count = 0;
    int64_t chunk_size = 0;
    std::map<int, std::string> etags;  // part number (1-based) -> ETag
  };

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

  std::mutex mutex_;
  std::map<std::string, Multipart> multipart_;
};

}  // namespace storage
