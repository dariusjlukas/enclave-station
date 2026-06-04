#include "upload_manager.h"
#include <vector>
#include "handlers/format_utils.h"

UploadManager::UploadManager(storage::StorageBackend& storage) : storage_(storage) {}

std::string UploadManager::create_session(
  const std::string& user_id,
  int64_t total_size,
  int chunk_count,
  int64_t chunk_size,
  const nlohmann::json& metadata) {
  cleanup_stale();

  std::string upload_id = format_utils::random_hex(16);
  if (!storage_.create_multipart(upload_id, total_size, chunk_count, chunk_size)) {
    return "";
  }

  std::lock_guard<std::mutex> lock(mutex_);
  UploadSession session;
  session.upload_id = upload_id;
  session.user_id = user_id;
  session.total_size = total_size;
  session.chunk_count = chunk_count;
  session.chunk_size = chunk_size;
  session.created_at = std::chrono::steady_clock::now();
  session.metadata = metadata;
  sessions_[upload_id] = std::move(session);
  return upload_id;
}

std::optional<UploadSession> UploadManager::get_session(const std::string& upload_id) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = sessions_.find(upload_id);
  if (it == sessions_.end()) return std::nullopt;
  return it->second;
}

std::string UploadManager::store_chunk_err(
  const std::string& upload_id,
  int index,
  std::string_view data,
  const std::string& expected_hash) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (sessions_.find(upload_id) == sessions_.end()) return "session_not_found";
  }
  return storage_.put_part(upload_id, index, data, expected_hash);
}

bool UploadManager::store_chunk(
  const std::string& upload_id,
  int index,
  std::string_view data,
  const std::string& expected_hash) {
  return store_chunk_err(upload_id, index, data, expected_hash).empty();
}

bool UploadManager::is_complete(const std::string& upload_id) const {
  int chunk_count = 0;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = sessions_.find(upload_id);
    if (it == sessions_.end()) return false;
    chunk_count = it->second.chunk_count;
  }
  return storage_.multipart_received(upload_id) == chunk_count;
}

int64_t UploadManager::assemble(const std::string& upload_id, const std::string& final_key) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (sessions_.find(upload_id) == sessions_.end()) return -1;
  }
  return storage_.complete_multipart(upload_id, final_key);
}

void UploadManager::remove_session(const std::string& upload_id) {
  storage_.abort_multipart(upload_id);
  std::lock_guard<std::mutex> lock(mutex_);
  sessions_.erase(upload_id);
}

void UploadManager::cleanup_stale(int max_age_seconds) {
  std::vector<std::string> stale;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto now = std::chrono::steady_clock::now();
    for (auto it = sessions_.begin(); it != sessions_.end();) {
      auto age =
        std::chrono::duration_cast<std::chrono::seconds>(now - it->second.created_at).count();
      if (age > max_age_seconds) {
        stale.push_back(it->first);
        it = sessions_.erase(it);
      } else {
        ++it;
      }
    }
  }
  for (const auto& id : stale) storage_.abort_multipart(id);
}
