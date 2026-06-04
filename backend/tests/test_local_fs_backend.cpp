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

using MultipartState = storage::StorageBackend::MultipartState;

static MultipartState mkstate(int64_t total, int count, int64_t csize) {
  MultipartState st;
  st.total_size = total;
  st.chunk_count = count;
  st.chunk_size = csize;
  return st;
}

TEST_F(LocalFsBackendTest, MultipartRoundTrip) {
  const std::string upload_id = "up0001";
  auto st = mkstate(/*total=*/10, /*count=*/3, /*csize=*/4);  // last chunk 2 bytes
  ASSERT_TRUE(backend_->create_multipart(upload_id, st));

  std::string tok;
  EXPECT_EQ(backend_->put_part(upload_id, st, 0, "AAAA", "", tok), "");
  st.part_tokens[0] = tok;
  EXPECT_EQ(backend_->put_part(upload_id, st, 1, "BBBB", "", tok), "");
  st.part_tokens[1] = tok;
  EXPECT_EQ(backend_->put_part(upload_id, st, 2, "CC", "", tok), "");
  st.part_tokens[2] = tok;

  int64_t size = backend_->complete_multipart(upload_id, st, "finalkey");
  EXPECT_EQ(size, 10);
  auto r = backend_->get("finalkey");
  ASSERT_TRUE(r.ok);
  EXPECT_EQ(r.data, "AAAABBBBCC");
}

TEST_F(LocalFsBackendTest, MultipartHashMismatch) {
  auto st = mkstate(4, 1, 4);
  ASSERT_TRUE(backend_->create_multipart("u", st));
  std::string tok;
  EXPECT_EQ(backend_->put_part("u", st, 0, "AAAA", "deadbeef", tok), "hash_mismatch");
}

TEST_F(LocalFsBackendTest, MultipartSizeMismatchFailsComplete) {
  // Declare total 8 but only write 4 bytes; complete must fail (-1).
  auto st = mkstate(8, 2, 4);
  ASSERT_TRUE(backend_->create_multipart("u", st));
  std::string tok;
  EXPECT_EQ(backend_->put_part("u", st, 0, "AAAA", "", tok), "");
  st.part_tokens[0] = tok;
  EXPECT_EQ(backend_->complete_multipart("u", st, "k"), -1);
}

TEST_F(LocalFsBackendTest, AbortMultipartRemovesStaging) {
  auto st = mkstate(4, 1, 4);
  ASSERT_TRUE(backend_->create_multipart("u", st));
  backend_->abort_multipart("u", st);
  // After abort, a chunk write fails because the staging temp file is gone.
  std::string tok;
  EXPECT_NE(backend_->put_part("u", st, 0, "AAAA", "", tok), "");
}
