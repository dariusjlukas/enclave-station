#pragma once

#include <cstdint>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include "db/database.h"
#include "storage/storage_backend.h"

// Coordinates chunked uploads. Session metadata + the backend's multipart state
// (handle + per-part tokens) live in the shared DB (upload_sessions table), and
// byte staging is delegated to a StorageBackend. Because all state is shared,
// a chunked upload's init / chunk / complete requests can be served by
// different backend instances — no load-balancer session affinity required
// (with S3 storage; local-fs additionally needs a shared filesystem for the
// staging temp file).
struct UploadSession {
  std::string upload_id;
  std::string user_id;
  int64_t total_size = 0;
  int chunk_count = 0;
  int64_t chunk_size = 0;
  nlohmann::json metadata;
};

class UploadManager {
public:
  UploadManager(Database& db, storage::StorageBackend& storage);

  // Create a new upload session, returns upload_id (empty string on failure).
  std::string create_session(
    const std::string& user_id,
    int64_t total_size,
    int chunk_count,
    int64_t chunk_size,
    const nlohmann::json& metadata);

  // Look up a session (metadata only) by id.
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

  // Clean up sessions older than max_age_seconds (and their backend staging).
  void cleanup_stale(int max_age_seconds = 3600);

private:
  // Load the storage MultipartState for `upload_id` from the DB row's
  // storage_state JSON. Returns nullopt if the session is missing.
  std::optional<storage::StorageBackend::MultipartState> load_state(const std::string& upload_id);

  Database& db_;
  storage::StorageBackend& storage_;
};
