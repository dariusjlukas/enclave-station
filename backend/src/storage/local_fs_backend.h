#pragma once
#include <chrono>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include "storage/storage_backend.h"

namespace storage {

// Filesystem-backed StorageBackend: blobs are flat files under `root` named by
// key; multipart uploads stage bytes in a single sparse temp file (pwrite at
// offset) under root/tmp and finalize with a same-filesystem rename. This is
// the original (single-instance) storage behavior, now behind the interface.
class LocalFsBackend : public StorageBackend {
public:
  explicit LocalFsBackend(const std::string& root);

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

private:
  struct Part {
    std::string tmp_path;
    int64_t total_size = 0;
    int chunk_count = 0;
    int64_t chunk_size = 0;
    std::set<int> received;
    std::chrono::steady_clock::time_point created_at;
  };

  std::string path_for(const std::string& key) const;

  std::string root_;
  std::string tmp_dir_;
  std::mutex mutex_;
  std::map<std::string, Part> parts_;
};

}  // namespace storage
