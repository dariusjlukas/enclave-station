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

std::string LocalFsBackend::tmp_path_for(const std::string& upload_id) const {
  return tmp_dir_ + "/" + upload_id + ".dat";
}

bool LocalFsBackend::create_multipart(const std::string& upload_id, MultipartState& st) {
  // Pre-allocate the sparse temp file. The path is derived from upload_id, so no
  // in-process state is kept; another instance sharing the filesystem can write
  // chunks for the same upload.
  std::string tmp_path = tmp_path_for(upload_id);
  int fd = open(tmp_path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return false;
  close(fd);
  st.handle = "";  // local fs needs no handle
  return true;
}

std::string LocalFsBackend::put_part(
  const std::string& upload_id,
  const MultipartState& st,
  int index,
  std::string_view bytes,
  const std::string& expected_sha256_hex,
  std::string& token_out) {
  if (index < 0 || index >= st.chunk_count) return "invalid_index";
  int64_t offset = 0;
  if (__builtin_mul_overflow(static_cast<int64_t>(index), st.chunk_size, &offset)) {
    return "invalid_index";
  }
  if (offset < 0) return "invalid_index";

  if (!expected_sha256_hex.empty()) {
    if (sha256_hex(bytes) != expected_sha256_hex) return "hash_mismatch";
  }

  FdGuard guard(open(tmp_path_for(upload_id).c_str(), O_WRONLY));
  if (guard.fd < 0) return "open_failed";
  ssize_t written = pwrite(guard.fd, bytes.data(), bytes.size(), offset);
  if (written < 0) return "io_error";
  if (static_cast<size_t>(written) < bytes.size()) return "short_write";
  token_out = "";  // local fs has no per-part token
  return "";
}

int64_t LocalFsBackend::complete_multipart(
  const std::string& upload_id, const MultipartState& st, const std::string& final_key) {
  std::string tmp_path = tmp_path_for(upload_id);
  std::error_code ec;
  auto actual = static_cast<int64_t>(fs::file_size(tmp_path, ec));
  if (ec || actual != st.total_size) return -1;
  fs::rename(tmp_path, path_for(final_key), ec);
  if (ec) return -1;
  return st.total_size;
}

void LocalFsBackend::abort_multipart(const std::string& upload_id, const MultipartState& /*st*/) {
  std::error_code ec;
  fs::remove(tmp_path_for(upload_id), ec);
}

}  // namespace storage
