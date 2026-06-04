#include "storage/storage_factory.h"

#include <stdexcept>
#include "logging/logger.h"
#include "storage/local_fs_backend.h"
#include "storage/s3_backend.h"

namespace storage {

std::unique_ptr<StorageBackend> make_storage_backend(const Config& config) {
  if (config.storage_backend == "local" || config.storage_backend.empty()) {
    LOG_INFO_N("storage", nullptr, "Using local filesystem storage at " + config.upload_dir);
    return std::make_unique<LocalFsBackend>(config.upload_dir);
  }

  if (config.storage_backend == "s3") {
    if (config.s3_endpoint.empty() || config.s3_bucket.empty()) {
      throw std::runtime_error("STORAGE_BACKEND=s3 requires S3_ENDPOINT and S3_BUCKET to be set");
    }
    S3Config s3;
    s3.endpoint = config.s3_endpoint;
    s3.bucket = config.s3_bucket;
    s3.access_key = config.s3_access_key;
    s3.secret_key = config.s3_secret_key;
    s3.region = config.s3_region;
    auto backend = std::make_unique<S3Backend>(std::move(s3));
    if (!backend->health_check()) {
      throw std::runtime_error(
        "STORAGE_BACKEND=s3 but the bucket '" + config.s3_bucket + "' at " + config.s3_endpoint +
        " is not reachable/authorized. Check S3_ENDPOINT/S3_BUCKET/credentials.");
    }
    LOG_INFO_N(
      "storage",
      nullptr,
      "Using S3 storage: bucket '" + config.s3_bucket + "' at " + config.s3_endpoint);
    return backend;
  }

  throw std::runtime_error(
    "Unknown STORAGE_BACKEND '" + config.storage_backend + "' (expected 'local' or 's3')");
}

}  // namespace storage
