#pragma once

#include <chrono>
#include <cstdint>
#include <map>
#include <mutex>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include "storage/storage_backend.h"

// Coordinates chunked uploads: owns the per-upload session metadata (filename,
// content-type, owning channel/space, declared sizes) and delegates the actual
// byte staging + assembly to a StorageBackend (local FS or S3). The session
// metadata map is still in-process here; moving it to a shared store (DB) is
// what makes chunked uploads span instances and is handled alongside the S3
// backend.
struct UploadSession {
  std::string upload_id;
  std::string user_id;
  int64_t total_size = 0;
  int chunk_count = 0;
  int64_t chunk_size = 0;  // bytes per chunk (last chunk may be smaller)
  std::chrono::steady_clock::time_point created_at;
  nlohmann::json metadata;
};

class UploadManager {
public:
  explicit UploadManager(storage::StorageBackend& storage);

  // Create a new upload session, returns upload_id (empty string on failure).
  std::string create_session(
    const std::string& user_id,
    int64_t total_size,
    int chunk_count,
    int64_t chunk_size,
    const nlohmann::json& metadata);

  // Snapshot copy of a session by ID, or nullopt if not found.
  std::optional<UploadSession> get_session(const std::string& upload_id);

  // Stage chunk `index`. expected_hash (optional) is verified against the bytes.
  bool store_chunk(
    const std::string& upload_id,
    int index,
    std::string_view data,
    const std::string& expected_hash);

  // As store_chunk but returns "" on success or a short error token.
  std::string store_chunk_err(
    const std::string& upload_id,
    int index,
    std::string_view data,
    const std::string& expected_hash);

  // True once all chunks have been received.
  bool is_complete(const std::string& upload_id) const;

  // Assemble the staged parts into the blob `final_key`. Returns total_size or
  // -1 on failure.
  int64_t assemble(const std::string& upload_id, const std::string& final_key);

  // Discard the session and its staged bytes.
  void remove_session(const std::string& upload_id);

  // Clean up sessions older than max_age_seconds.
  void cleanup_stale(int max_age_seconds = 3600);

private:
  storage::StorageBackend& storage_;
  mutable std::mutex mutex_;
  std::map<std::string, UploadSession> sessions_;
};
