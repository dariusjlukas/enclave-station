#pragma once
#include <string>
#include "storage/storage_backend.h"

namespace storage {

// Filesystem-backed StorageBackend: blobs are flat files under `root` named by
// key; multipart uploads stage bytes in a single sparse temp file (pwrite at
// offset) under root/tmp, keyed deterministically by upload_id, and finalize
// with a same-filesystem rename. Stateless: no in-process session map (the temp
// path is derived from upload_id), so two instances sharing the filesystem can
// each serve chunks for the same upload.
class LocalFsBackend : public StorageBackend {
public:
  explicit LocalFsBackend(const std::string& root);

  bool put(const std::string& key, std::string_view bytes) override;
  GetResult get(const std::string& key) override;
  bool exists(const std::string& key) override;
  void remove(const std::string& key) override;

  bool create_multipart(const std::string& upload_id, MultipartState& st) override;
  std::string put_part(
    const std::string& upload_id,
    const MultipartState& st,
    int index,
    std::string_view bytes,
    const std::string& expected_sha256_hex,
    std::string& token_out) override;
  int64_t complete_multipart(
    const std::string& upload_id, const MultipartState& st, const std::string& final_key) override;
  void abort_multipart(const std::string& upload_id, const MultipartState& st) override;

private:
  std::string path_for(const std::string& key) const;
  std::string tmp_path_for(const std::string& upload_id) const;

  std::string root_;
  std::string tmp_dir_;
};

}  // namespace storage
