#include <gtest/gtest.h>
#include <filesystem>
#include <random>
#include <string>
#include "storage/local_fs_backend.h"

namespace fs = std::filesystem;

class LocalFsBackendTest : public ::testing::Test {
protected:
  void SetUp() override {
    auto base = fs::temp_directory_path();
    std::random_device rd;
    std::mt19937_64 rng(rd());
    dir_ = (base / ("lfs_test_" + std::to_string(rng()))).string();
    fs::create_directories(dir_);
    backend_ = std::make_unique<storage::LocalFsBackend>(dir_);
  }
  void TearDown() override {
    backend_.reset();
    std::error_code ec;
    fs::remove_all(dir_, ec);
  }
  std::string dir_;
  std::unique_ptr<storage::LocalFsBackend> backend_;
};

TEST_F(LocalFsBackendTest, PutGetRoundTrip) {
  ASSERT_TRUE(backend_->put("abc123", "hello world"));
  EXPECT_TRUE(backend_->exists("abc123"));
  auto r = backend_->get("abc123");
  ASSERT_TRUE(r.ok);
  EXPECT_EQ(r.data, "hello world");
}

TEST_F(LocalFsBackendTest, GetMissingKeyReportsNotOk) {
  auto r = backend_->get("nope");
  EXPECT_FALSE(r.ok);
  EXPECT_FALSE(backend_->exists("nope"));
}

TEST_F(LocalFsBackendTest, PutOverwrites) {
  ASSERT_TRUE(backend_->put("k", "first"));
  ASSERT_TRUE(backend_->put("k", "second"));
  EXPECT_EQ(backend_->get("k").data, "second");
}

TEST_F(LocalFsBackendTest, RemoveIsIdempotent) {
  ASSERT_TRUE(backend_->put("k", "x"));
  backend_->remove("k");
  EXPECT_FALSE(backend_->exists("k"));
  // Removing a missing key is a no-op, not an error.
  backend_->remove("k");
  backend_->remove("never-existed");
}

TEST_F(LocalFsBackendTest, EmptyBlob) {
  ASSERT_TRUE(backend_->put("empty", ""));
  auto r = backend_->get("empty");
  ASSERT_TRUE(r.ok);
  EXPECT_TRUE(r.data.empty());
}

TEST_F(LocalFsBackendTest, MultipartRoundTrip) {
  const std::string upload_id = "up0001";
  const int64_t chunk_size = 4;
  const int chunk_count = 3;
  const int64_t total = 10;  // last chunk is 2 bytes
  ASSERT_TRUE(backend_->create_multipart(upload_id, total, chunk_count, chunk_size));

  EXPECT_EQ(backend_->put_part(upload_id, 0, "AAAA", ""), "");
  EXPECT_EQ(backend_->put_part(upload_id, 1, "BBBB", ""), "");
  EXPECT_EQ(backend_->put_part(upload_id, 2, "CC", ""), "");
  EXPECT_EQ(backend_->multipart_received(upload_id), 3);

  int64_t size = backend_->complete_multipart(upload_id, "finalkey");
  EXPECT_EQ(size, total);
  auto r = backend_->get("finalkey");
  ASSERT_TRUE(r.ok);
  EXPECT_EQ(r.data, "AAAABBBBCC");
  // The staging session is gone after completion.
  EXPECT_EQ(backend_->multipart_received(upload_id), -1);
}

TEST_F(LocalFsBackendTest, MultipartHashMismatch) {
  ASSERT_TRUE(backend_->create_multipart("u", 4, 1, 4));
  // Wrong hash for "AAAA".
  EXPECT_EQ(backend_->put_part("u", 0, "AAAA", "deadbeef"), "hash_mismatch");
}

TEST_F(LocalFsBackendTest, MultipartSizeMismatchFailsComplete) {
  // Declare total 8 but only write 4 bytes; complete must fail (-1).
  ASSERT_TRUE(backend_->create_multipart("u", 8, 2, 4));
  EXPECT_EQ(backend_->put_part("u", 0, "AAAA", ""), "");
  // part 1 never written -> file is 4 bytes, total declared 8.
  EXPECT_EQ(backend_->complete_multipart("u", "k"), -1);
}

TEST_F(LocalFsBackendTest, AbortMultipartDropsSession) {
  ASSERT_TRUE(backend_->create_multipart("u", 4, 1, 4));
  backend_->abort_multipart("u");
  EXPECT_EQ(backend_->multipart_received("u"), -1);
}
