#pragma once
#include <cstdint>
#include <memory>
#include <optional>
#include <string>

// Abstraction over where uploaded file blobs live. Two implementations:
//   - LocalFsBackend: flat files under a local directory (default; single
//     instance / dev). Zero external dependencies.
//   - S3Backend: an S3-compatible object store (MinIO, Garage, Ceph RGW,
//     OpenStack Swift s3api, or any cloud). Enables horizontal scaling: every
//     instance reads/writes the same shared store.
//
// Blobs are addressed by an opaque `key` — the server-generated 32-byte hex id
// (`disk_file_id` / `file_id`). The backend owns the key->location mapping, so
// handlers no longer build filesystem paths.
//
// The chunked-upload path is modeled as a generic multipart API so a chunked
// upload can span instances: parts are staged in the shared store keyed by an
// upload id, then assembled into the final object. LocalFsBackend implements
// this with the existing pwrite-at-offset temp file; S3Backend uses native S3
// multipart uploads.
namespace storage {

// Result of a blob read. `ok == false` means the key was not found (or an I/O
// error occurred); `data` holds the full bytes on success.
struct GetResult {
  bool ok = false;
  std::string data;
};

class StorageBackend {
public:
  virtual ~StorageBackend() = default;

  // --- Whole-blob operations (single-shot uploads, downloads, deletes) ---

  // Store `bytes` under `key`, overwriting any existing object. Returns false
  // on failure (the caller maps this to a 500).
  virtual bool put(const std::string& key, std::string_view bytes) = 0;

  // Read the whole object. GetResult.ok is false if the key is absent.
  virtual GetResult get(const std::string& key) = 0;

  // True if an object exists for `key`.
  virtual bool exists(const std::string& key) = 0;

  // Remove `key`. Missing keys are not an error (idempotent).
  virtual void remove(const std::string& key) = 0;

  // --- Multipart (chunked) uploads ---
  //
  // A chunked upload streams `total_size` bytes as `chunk_count` parts of
  // `chunk_size` each (the last part may be smaller). The flow is:
  //   create_multipart -> put_part * N -> complete_multipart(final_key)
  // or abort_multipart on cancel. multipart_received() reports how many parts
  // have landed so the handler can detect completion across instances.

  // Begin a multipart upload. `upload_id` is the server-generated id the
  // handler already minted (random_hex(16)); the backend uses it as the
  // staging key. Returns false on failure.
  virtual bool create_multipart(
    const std::string& upload_id, int64_t total_size, int chunk_count, int64_t chunk_size) = 0;

  // Store part `index` (0-based) of an in-progress multipart upload.
  // `expected_sha256_hex` (optional, empty to skip) is verified against the
  // part bytes. Returns an empty string on success, or a short error token
  // ("session_gone", "hash_mismatch", "open_failed", ...) on failure.
  virtual std::string put_part(
    const std::string& upload_id,
    int index,
    std::string_view bytes,
    const std::string& expected_sha256_hex) = 0;

  // Number of distinct parts received so far for `upload_id` (or -1 if the
  // upload is unknown).
  virtual int multipart_received(const std::string& upload_id) = 0;

  // Finalize: assemble the staged parts into a single object under `final_key`.
  // Returns the assembled object's size in bytes, or -1 on failure (including a
  // size mismatch vs the declared total_size).
  virtual int64_t complete_multipart(
    const std::string& upload_id, const std::string& final_key) = 0;

  // Discard an in-progress multipart upload and its staged parts.
  virtual void abort_multipart(const std::string& upload_id) = 0;

  // Drop multipart uploads idle longer than `max_age_seconds` (housekeeping).
  virtual void cleanup_stale_multipart(int max_age_seconds) = 0;
};

}  // namespace storage
