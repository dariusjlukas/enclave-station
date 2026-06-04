#pragma once
#include <cstdint>
#include <map>
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
  // or abort_multipart on cancel.
  //
  // The multipart API is STATELESS: all per-upload state lives in MultipartState
  // (the storage handle, declared sizes, and per-part tokens), which the caller
  // (UploadManager) persists to the shared DB between calls. This is what lets a
  // chunked upload's init/chunk/complete be served by different instances. For
  // S3 the handle is the S3 multipart upload id and part tokens are ETags; for
  // local FS the handle/tokens are unused (a sparse temp file is keyed by
  // upload_id) — local FS still needs a shared filesystem to span instances.

  struct MultipartState {
    std::string handle;        // backend handle (S3 upload id; "" for local fs)
    int64_t total_size = 0;
    int chunk_count = 0;
    int64_t chunk_size = 0;
    std::map<int, std::string> part_tokens;  // 0-based index -> token (ETag)
  };

  // Begin a multipart upload. `st.total_size/chunk_count/chunk_size` are
  // pre-filled by the caller; the backend fills `st.handle`. Returns false on
  // failure.
  virtual bool create_multipart(const std::string& upload_id, MultipartState& st) = 0;

  // Store part `index` (0-based). On success returns "" and sets `token_out` to
  // the part's token (an S3 ETag, or "" for local fs). On failure returns a
  // short error token ("hash_mismatch", "open_failed", "io_error", ...).
  virtual std::string put_part(
    const std::string& upload_id,
    const MultipartState& st,
    int index,
    std::string_view bytes,
    const std::string& expected_sha256_hex,
    std::string& token_out) = 0;

  // Finalize: assemble the staged parts into a single object under `final_key`.
  // Returns the assembled object's size in bytes, or -1 on failure (incl. a
  // size mismatch vs st.total_size).
  virtual int64_t complete_multipart(
    const std::string& upload_id, const MultipartState& st, const std::string& final_key) = 0;

  // Discard an in-progress multipart upload and its staged parts.
  virtual void abort_multipart(const std::string& upload_id, const MultipartState& st) = 0;
};

}  // namespace storage
