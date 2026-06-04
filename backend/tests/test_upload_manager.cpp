#include <gtest/gtest.h>
#include <sys/stat.h>
#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <limits>
#include <random>
#include <string>
#include <thread>
#include <vector>

#include <memory>
#include <nlohmann/json.hpp>

#include "config.h"
#include "db/database.h"
#include "storage/local_fs_backend.h"
#include "upload_manager.h"

namespace fs = std::filesystem;

namespace {

// Creates a unique temp directory rooted under the system temp dir so each
// test case gets its own storage backend working directory. The fixture
// removes it in TearDown.
std::string make_temp_dir(const std::string& label) {
  auto base = fs::temp_directory_path();
  std::random_device rd;
  std::mt19937_64 rng(rd());
  std::string name = "upload_mgr_test_" + label + "_" + std::to_string(rng());
  auto p = base / name;
  fs::create_directories(p);
  return p.string();
}

// UploadManager is now DB-backed (session + multipart state live in the
// upload_sessions table), so these are integration tests that need Postgres.
class UploadManagerTest : public ::testing::Test {
protected:
  static void SetUpTestSuite() {
    auto config = Config::from_env();
    conn_string_ = config.pg_connection_string();
    db_ = std::make_unique<Database>(conn_string_);
    db_->run_migrations();
  }

  void SetUp() override {
    // Fresh per-test staging dir and a fresh owning user (upload_sessions has an
    // ON DELETE CASCADE FK to users).
    dir_ = make_temp_dir("base");
    storage_ = std::make_unique<storage::LocalFsBackend>(dir_);

    pqxx::connection conn(conn_string_);
    pqxx::work txn(conn);
    txn.exec("DELETE FROM upload_sessions");
    txn.exec("DELETE FROM users");
    txn.commit();

    auto user = db_->create_user("uploader", "Uploader", "PEM_KEY_UPLOADER");
    user_id_ = user.id;
  }

  void TearDown() override {
    storage_.reset();
    std::error_code ec;
    // Best-effort: restore permissions before removing in case a test chmod'd.
    fs::permissions(
      dir_ + "/tmp",
      fs::perms::owner_all | fs::perms::group_read | fs::perms::others_read,
      fs::perm_options::replace,
      ec);
    fs::remove_all(dir_, ec);
  }

  storage::StorageBackend& storage() { return *storage_; }

  static std::unique_ptr<Database> db_;
  static std::string conn_string_;

  std::string dir_;
  std::string user_id_;
  std::unique_ptr<storage::LocalFsBackend> storage_;
};

std::unique_ptr<Database> UploadManagerTest::db_;
std::string UploadManagerTest::conn_string_;

}  // namespace

TEST_F(UploadManagerTest, ConcurrentStoreChunk) {
  UploadManager mgr(*db_, storage());
  constexpr int kChunkCount = 64;
  constexpr int64_t kChunkSize = 1024;
  constexpr int64_t kTotal = static_cast<int64_t>(kChunkCount) * kChunkSize;

  std::string upload_id =
    mgr.create_session(user_id_, kTotal, kChunkCount, kChunkSize, nlohmann::json::object());
  ASSERT_FALSE(upload_id.empty());

  // Partition the 64 chunks across 8 threads, writing disjoint subsets.
  constexpr int kThreads = 8;
  std::atomic<int> failures{0};
  std::vector<std::thread> workers;
  workers.reserve(kThreads);
  for (int t = 0; t < kThreads; ++t) {
    workers.emplace_back([&, t]() {
      std::string payload(static_cast<size_t>(kChunkSize), static_cast<char>('A' + t));
      for (int i = t; i < kChunkCount; i += kThreads) {
        std::string err = mgr.store_chunk_err(upload_id, i, payload, /*expected_hash=*/"");
        if (!err.empty()) {
          ++failures;
        }
      }
    });
  }
  for (auto& w : workers) w.join();

  EXPECT_EQ(failures.load(), 0);
  EXPECT_TRUE(mgr.is_complete(upload_id));

  // assemble() takes the destination blob KEY (not a path); the bytes land in
  // the storage backend.
  const std::string key = "assembled0001";
  int64_t size = mgr.assemble(upload_id, key);
  EXPECT_EQ(size, kTotal);

  // The assembled blob should be readable from storage at exactly kTotal bytes.
  auto blob = storage().get(key);
  ASSERT_TRUE(blob.ok);
  EXPECT_EQ(static_cast<int64_t>(blob.data.size()), kTotal);
}

// Simulates S3-style multipart: each chunk yields a distinct, non-empty part
// token (an ETag). Concurrent writers from different "instances" must not
// clobber each other's tokens in storage_state.part_tokens. (The LocalFs
// round-trip above can't catch this because its tokens are always empty.)
TEST_F(UploadManagerTest, ConcurrentTokenMergeNoClobber) {
  constexpr int kChunkCount = 50;
  const std::string upload_id = "merge_test_upload";
  // storage_state starts with an empty part_tokens object, as create_session
  // would write it.
  db_->create_upload_session(
    upload_id, user_id_, /*total_size=*/kChunkCount, kChunkCount, /*chunk_size=*/1,
    nlohmann::json::object().dump(),
    nlohmann::json{{"part_tokens", nlohmann::json::object()}}.dump());

  // Record all chunks concurrently, each with a unique token "etag-<i>".
  constexpr int kThreads = 8;
  std::atomic<int> failures{0};
  std::vector<std::thread> workers;
  workers.reserve(kThreads);
  for (int t = 0; t < kThreads; ++t) {
    workers.emplace_back([&, t]() {
      for (int i = t; i < kChunkCount; i += kThreads) {
        if (db_->record_upload_chunk(upload_id, i, "etag-" + std::to_string(i)) < 0) {
          ++failures;
        }
      }
    });
  }
  for (auto& w : workers) w.join();
  EXPECT_EQ(failures.load(), 0);

  // Every token must have survived the concurrent merges.
  auto row = db_->get_upload_session(upload_id);
  ASSERT_TRUE(row.has_value());
  EXPECT_EQ(row->received_count, kChunkCount);
  auto state = nlohmann::json::parse(row->storage_state);
  ASSERT_TRUE(state.contains("part_tokens"));
  const auto& tokens = state["part_tokens"];
  EXPECT_EQ(static_cast<int>(tokens.size()), kChunkCount);
  for (int i = 0; i < kChunkCount; ++i) {
    auto key = std::to_string(i);
    ASSERT_TRUE(tokens.contains(key)) << "missing token for chunk " << i;
    EXPECT_EQ(tokens[key].get<std::string>(), "etag-" + std::to_string(i));
  }
}

TEST_F(UploadManagerTest, OffsetOverflow) {
  UploadManager mgr(*db_, storage());
  constexpr int64_t kHugeChunk = std::numeric_limits<int64_t>::max() / 2;
  // chunk_count must be > 4 so index=4 is in-range and overflow is exercised.
  constexpr int kChunkCount = 10;

  std::string upload_id = mgr.create_session(
    user_id_, kHugeChunk, kChunkCount, kHugeChunk, nlohmann::json::object());
  ASSERT_FALSE(upload_id.empty());

  // A tiny body is fine — we should never reach pwrite because offset computation overflows.
  std::string err = mgr.store_chunk_err(upload_id, /*index=*/4, std::string(16, 'x'), "");
  EXPECT_EQ(err, "invalid_index");
}

TEST_F(UploadManagerTest, NegativeIndex) {
  UploadManager mgr(*db_, storage());
  std::string upload_id =
    mgr.create_session(user_id_, /*total_size=*/1024, /*chunk_count=*/4, /*chunk_size=*/256, {});
  ASSERT_FALSE(upload_id.empty());

  std::string err = mgr.store_chunk_err(upload_id, /*index=*/-1, std::string(256, 'a'), "");
  EXPECT_EQ(err, "invalid_index");
}

TEST_F(UploadManagerTest, IndexOutOfRange) {
  UploadManager mgr(*db_, storage());
  std::string upload_id =
    mgr.create_session(user_id_, /*total_size=*/1024, /*chunk_count=*/4, /*chunk_size=*/256, {});
  ASSERT_FALSE(upload_id.empty());

  // index == chunk_count is out of range (valid indices are [0, chunk_count))
  std::string err = mgr.store_chunk_err(upload_id, /*index=*/4, std::string(256, 'a'), "");
  EXPECT_EQ(err, "invalid_index");

  err = mgr.store_chunk_err(upload_id, /*index=*/99, std::string(256, 'a'), "");
  EXPECT_EQ(err, "invalid_index");
}

TEST_F(UploadManagerTest, OpenFailure) {
  // Skip this test if running as root — root bypasses DAC_OVERRIDE and can
  // always open the file regardless of mode bits.
  if (::geteuid() == 0) {
    GTEST_SKIP() << "Cannot test open() failure when running as root";
  }

  UploadManager mgr(*db_, storage());
  std::string upload_id =
    mgr.create_session(user_id_, /*total_size=*/1024, /*chunk_count=*/4, /*chunk_size=*/256, {});
  ASSERT_FALSE(upload_id.empty());

  // Make the on-disk temp file unwritable so the backend's open(O_WRONLY) fails.
  // The LocalFsBackend stages chunks in <dir>/tmp/<upload_id>.dat.
  std::string tmp_path = dir_ + "/tmp/" + upload_id + ".dat";
  ASSERT_EQ(::chmod(tmp_path.c_str(), 0), 0) << "chmod failed: " << strerror(errno);

  std::string err = mgr.store_chunk_err(upload_id, /*index=*/0, std::string(256, 'a'), "");

  // Restore permissions BEFORE asserting so a failure doesn't break teardown.
  ::chmod(tmp_path.c_str(), 0644);

  EXPECT_EQ(err, "open_failed");
}
