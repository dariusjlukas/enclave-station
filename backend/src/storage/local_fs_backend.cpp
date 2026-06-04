#include "storage/local_fs_backend.h"

#include <fcntl.h>
#include <openssl/sha.h>
#include <unistd.h>
#include <cerrno>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>

namespace fs = std::filesystem;

namespace storage {

namespace {
// RAII for a POSIX fd so it's always closed.
struct FdGuard {
  int fd;
  explicit FdGuard(int f) : fd(f) {}
  ~FdGuard() {
    if (fd >= 0) ::close(fd);
  }
  FdGuard(const FdGuard&) = delete;
  FdGuard& operator=(const FdGuard&) = delete;
};

std::string sha256_hex(std::string_view data) {
  unsigned char hash[SHA256_DIGEST_LENGTH];
  SHA256(reinterpret_cast<const unsigned char*>(data.data()), data.size(), hash);
  std::ostringstream oss;
  for (unsigned char i : hash) {
    oss << std::hex << std::setfill('0') << std::setw(2) << static_cast<int>(i);
  }
  return oss.str();
}
}  // namespace

LocalFsBackend::LocalFsBackend(const std::string& root) : root_(root), tmp_dir_(root + "/tmp") {
  fs::create_directories(tmp_dir_);
}

std::string LocalFsBackend::path_for(const std::string& key) const {
  return root_ + "/" + key;
}

bool LocalFsBackend::put(const std::string& key, std::string_view bytes) {
  std::ofstream out(path_for(key), std::ios::binary);
  if (!out) return false;
  out.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  out.close();
  return static_cast<bool>(out);
}

GetResult LocalFsBackend::get(const std::string& key) {
  std::ifstream in(path_for(key), std::ios::binary | std::ios::ate);
  if (!in) return {false, {}};
  auto size = in.tellg();
  in.seekg(0);
  GetResult r;
  r.data.resize(static_cast<size_t>(size));
  in.read(r.data.data(), size);
  r.ok = static_cast<bool>(in);
  if (!r.ok) r.data.clear();
  return r;
}

bool LocalFsBackend::exists(const std::string& key) {
  std::error_code ec;
  return fs::exists(path_for(key), ec);
}

void LocalFsBackend::remove(const std::string& key) {
  std::error_code ec;
  fs::remove(path_for(key), ec);
}

bool LocalFsBackend::create_multipart(
  const std::string& upload_id, int64_t total_size, int chunk_count, int64_t chunk_size) {
  cleanup_stale_multipart(3600);
  std::lock_guard<std::mutex> lock(mutex_);
  std::string tmp_path = tmp_dir_ + "/" + upload_id + ".dat";
  int fd = open(tmp_path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return false;
  close(fd);

  Part p;
  p.tmp_path = tmp_path;
  p.total_size = total_size;
  p.chunk_count = chunk_count;
  p.chunk_size = chunk_size;
  p.created_at = std::chrono::steady_clock::now();
  parts_[upload_id] = std::move(p);
  return true;
}

std::string LocalFsBackend::put_part(
  const std::string& upload_id,
  int index,
  std::string_view bytes,
  const std::string& expected_sha256_hex) {
  // Phase 1: validate under lock, copy what we need; don't hold the lock for I/O.
  std::string tmp_path;
  int64_t chunk_size = 0;
  int chunk_count = 0;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = parts_.find(upload_id);
    if (it == parts_.end()) return "session_not_found";
    tmp_path = it->second.tmp_path;
    chunk_size = it->second.chunk_size;
    chunk_count = it->second.chunk_count;
  }

  if (index < 0 || index >= chunk_count) return "invalid_index";
  int64_t offset = 0;
  if (__builtin_mul_overflow(static_cast<int64_t>(index), chunk_size, &offset)) {
    return "invalid_index";
  }
  if (offset < 0) return "invalid_index";

  if (!expected_sha256_hex.empty()) {
    if (sha256_hex(bytes) != expected_sha256_hex) return "hash_mismatch";
  }

  // Phase 2: pwrite with no lock held.
  FdGuard guard(open(tmp_path.c_str(), O_WRONLY));
  if (guard.fd < 0) return "open_failed";
  ssize_t written = pwrite(guard.fd, bytes.data(), bytes.size(), offset);
  if (written < 0) return "io_error";
  if (static_cast<size_t>(written) < bytes.size()) return "short_write";

  // Phase 3: record receipt under lock.
  {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = parts_.find(upload_id);
    if (it == parts_.end()) return "session_gone";
    it->second.received.insert(index);
  }
  return "";
}

int LocalFsBackend::multipart_received(const std::string& upload_id) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = parts_.find(upload_id);
  if (it == parts_.end()) return -1;
  return static_cast<int>(it->second.received.size());
}

int64_t LocalFsBackend::complete_multipart(
  const std::string& upload_id, const std::string& final_key) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = parts_.find(upload_id);
  if (it == parts_.end()) return -1;

  std::error_code ec;
  auto actual = static_cast<int64_t>(fs::file_size(it->second.tmp_path, ec));
  if (ec || actual != it->second.total_size) return -1;

  fs::rename(it->second.tmp_path, path_for(final_key), ec);
  if (ec) return -1;
  int64_t size = it->second.total_size;
  // The temp file has been renamed away; drop the session.
  parts_.erase(it);
  return size;
}

void LocalFsBackend::abort_multipart(const std::string& upload_id) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = parts_.find(upload_id);
  if (it != parts_.end()) {
    std::error_code ec;
    fs::remove(it->second.tmp_path, ec);
    parts_.erase(it);
  }
}

void LocalFsBackend::cleanup_stale_multipart(int max_age_seconds) {
  std::lock_guard<std::mutex> lock(mutex_);
  auto now = std::chrono::steady_clock::now();
  for (auto it = parts_.begin(); it != parts_.end();) {
    auto age =
      std::chrono::duration_cast<std::chrono::seconds>(now - it->second.created_at).count();
    if (age > max_age_seconds) {
      std::error_code ec;
      fs::remove(it->second.tmp_path, ec);
      it = parts_.erase(it);
    } else {
      ++it;
    }
  }
}

}  // namespace storage
