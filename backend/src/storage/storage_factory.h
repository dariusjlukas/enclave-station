#pragma once
#include <memory>
#include "config.h"
#include "storage/storage_backend.h"

namespace storage {

// Construct the storage backend selected by config.storage_backend ("local" or
// "s3"). Throws std::runtime_error if "s3" is selected but misconfigured, or on
// an unknown backend name. For "local" the upload directory must already exist.
std::unique_ptr<StorageBackend> make_storage_backend(const Config& config);

}  // namespace storage
