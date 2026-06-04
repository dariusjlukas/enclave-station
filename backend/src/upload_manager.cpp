#include "upload_manager.h"
#include "handlers/format_utils.h"

namespace {
using MultipartState = storage::StorageBackend::MultipartState;

// MultipartState <-> JSON. Stored in upload_sessions.storage_state.
nlohmann::json state_to_json(const MultipartState& st) {
  nlohmann::json parts = nlohmann::json::object();
  for (const auto& [idx, token] : st.part_tokens) {
    parts[std::to_string(idx)] = token;
  }
  return nlohmann::json{
    {"handle", st.handle},
    {"total_size", st.total_size},
    {"chunk_count", st.chunk_count},
    {"chunk_size", st.chunk_size},
    {"part_tokens", parts}};
}

MultipartState state_from_json(const nlohmann::json& j) {
  MultipartState st;
  st.handle = j.value("handle", "");
  st.total_size = j.value("total_size", static_cast<int64_t>(0));
  st.chunk_count = j.value("chunk_count", 0);
  st.chunk_size = j.value("chunk_size", static_cast<int64_t>(0));
  if (j.contains("part_tokens") && j["part_tokens"].is_object()) {
    for (auto it = j["part_tokens"].begin(); it != j["part_tokens"].end(); ++it) {
      st.part_tokens[std::stoi(it.key())] = it.value().get<std::string>();
    }
  }
  return st;
}
}  // namespace

UploadManager::UploadManager(Database& db, storage::StorageBackend& storage)
  : db_(db), storage_(storage) {}

std::optional<MultipartState> UploadManager::load_state(const std::string& upload_id) {
  auto row = db_.get_upload_session(upload_id);
  if (!row) return std::nullopt;
  try {
    return state_from_json(nlohmann::json::parse(row->storage_state));
  } catch (const std::exception&) {
    return std::nullopt;
  }
}

std::string UploadManager::create_session(
  const std::string& user_id,
  int64_t total_size,
  int chunk_count,
  int64_t chunk_size,
  const nlohmann::json& metadata) {
  cleanup_stale();

  std::string upload_id = format_utils::random_hex(16);

  MultipartState st;
  st.total_size = total_size;
  st.chunk_count = chunk_count;
  st.chunk_size = chunk_size;
  if (!storage_.create_multipart(upload_id, st)) {
    return "";
  }

  try {
    db_.create_upload_session(
      upload_id,
      user_id,
      total_size,
      chunk_count,
      chunk_size,
      metadata.dump(),
      state_to_json(st).dump());
  } catch (const std::exception&) {
    storage_.abort_multipart(upload_id, st);
    return "";
  }
  return upload_id;
}

std::optional<UploadSession> UploadManager::get_session(const std::string& upload_id) {
  auto row = db_.get_upload_session(upload_id);
  if (!row) return std::nullopt;
  UploadSession s;
  s.upload_id = row->upload_id;
  s.user_id = row->user_id;
  s.total_size = row->total_size;
  s.chunk_count = row->chunk_count;
  s.chunk_size = row->chunk_size;
  try {
    s.metadata = nlohmann::json::parse(row->metadata);
  } catch (const std::exception&) {
    s.metadata = nlohmann::json::object();
  }
  return s;
}

std::string UploadManager::store_chunk_err(
  const std::string& upload_id,
  int index,
  std::string_view data,
  const std::string& expected_hash) {
  auto st = load_state(upload_id);
  if (!st) return "session_not_found";

  std::string token;
  std::string err = storage_.put_part(upload_id, *st, index, data, expected_hash, token);
  if (!err.empty()) return err;

  // Mark the chunk received and merge just this part's token into the DB row.
  // record_upload_chunk merges only storage_state.part_tokens[index] (not the
  // whole state), so concurrent writers from other instances don't clobber each
  // other's tokens.
  if (db_.record_upload_chunk(upload_id, index, token) < 0) {
    return "session_gone";
  }
  return "";
}

bool UploadManager::store_chunk(
  const std::string& upload_id,
  int index,
  std::string_view data,
  const std::string& expected_hash) {
  return store_chunk_err(upload_id, index, data, expected_hash).empty();
}

bool UploadManager::is_complete(const std::string& upload_id) const {
  auto row = db_.get_upload_session(upload_id);
  if (!row) return false;
  return row->received_count == row->chunk_count;
}

int64_t UploadManager::assemble(const std::string& upload_id, const std::string& final_key) {
  auto st = load_state(upload_id);
  if (!st) return -1;
  return storage_.complete_multipart(upload_id, *st, final_key);
}

void UploadManager::remove_session(const std::string& upload_id) {
  if (auto st = load_state(upload_id)) {
    storage_.abort_multipart(upload_id, *st);
  }
  db_.delete_upload_session(upload_id);
}

void UploadManager::cleanup_stale(int max_age_seconds) {
  auto stale = db_.reap_stale_upload_sessions(max_age_seconds);
  for (const auto& [upload_id, state_json] : stale) {
    try {
      auto st = state_from_json(nlohmann::json::parse(state_json));
      storage_.abort_multipart(upload_id, st);
    } catch (const std::exception&) {
      // best-effort cleanup
    }
  }
}
