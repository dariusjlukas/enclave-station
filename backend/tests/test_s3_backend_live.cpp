#include <gtest/gtest.h>
#include <cstdlib>
#include <string>
#include "storage/s3_backend.h"

// Live round-trip tests against a real S3-compatible server (MinIO). Skipped
// unless S3_TEST_ENDPOINT / S3_TEST_BUCKET / S3_TEST_ACCESS_KEY /
// S3_TEST_SECRET_KEY are set in the environment, so the normal unit suite does
// not require a running object store.

namespace {
std::string envv(const char* name) {
  const char* v = std::getenv(name);
  return v ? v : "";
}
bool s3_configured() {
  return !envv("S3_TEST_ENDPOINT").empty() && !envv("S3_TEST_BUCKET").empty() &&
         !envv("S3_TEST_ACCESS_KEY").empty() && !envv("S3_TEST_SECRET_KEY").empty();
}
storage::S3Backend make_backend() {
  storage::S3Config c;
  c.endpoint = envv("S3_TEST_ENDPOINT");
  c.bucket = envv("S3_TEST_BUCKET");
  c.access_key = envv("S3_TEST_ACCESS_KEY");
  c.secret_key = envv("S3_TEST_SECRET_KEY");
  c.region = "us-east-1";
  return storage::S3Backend(std::move(c));
}
}  // namespace

class S3BackendLiveTest : public ::testing::Test {
protected:
  void SetUp() override {
    if (!s3_configured()) GTEST_SKIP() << "S3_TEST_* env not set; skipping live S3 tests";
  }
};

TEST_F(S3BackendLiveTest, HealthCheck) {
  auto b = make_backend();
  EXPECT_TRUE(b.health_check());
}

TEST_F(S3BackendLiveTest, PutGetExistsRemove) {
  auto b = make_backend();
  const std::string key = "test_putget_0001";
  ASSERT_TRUE(b.put(key, "hello s3 world"));
  EXPECT_TRUE(b.exists(key));
  auto r = b.get(key);
  ASSERT_TRUE(r.ok);
  EXPECT_EQ(r.data, "hello s3 world");
  b.remove(key);
  EXPECT_FALSE(b.exists(key));
  EXPECT_FALSE(b.get(key).ok);
}

TEST_F(S3BackendLiveTest, PutOverwrites) {
  auto b = make_backend();
  const std::string key = "test_overwrite_0001";
  ASSERT_TRUE(b.put(key, "first"));
  ASSERT_TRUE(b.put(key, "second"));
  EXPECT_EQ(b.get(key).data, "second");
  b.remove(key);
}

TEST_F(S3BackendLiveTest, BinarySafe) {
  auto b = make_backend();
  const std::string key = "test_binary_0001";
  std::string blob;
  for (int i = 0; i < 256; ++i) blob.push_back(static_cast<char>(i));
  blob += blob;  // 512 bytes including NULs and high bytes
  ASSERT_TRUE(b.put(key, blob));
  auto r = b.get(key);
  ASSERT_TRUE(r.ok);
  EXPECT_EQ(r.data, blob);
  b.remove(key);
}

TEST_F(S3BackendLiveTest, MultipartRoundTrip) {
  auto b = make_backend();
  const std::string upload_id = "test_mp_0001";
  // 3 parts; S3 requires each non-final part >= 5 MiB. Use 5 MiB parts.
  const int64_t part = 5 * 1024 * 1024;
  const int chunk_count = 2;
  const int64_t total = part + 7;  // last part is 7 bytes
  ASSERT_TRUE(b.create_multipart(upload_id, total, chunk_count, part));

  std::string p0(static_cast<size_t>(part), 'A');
  std::string p1 = "LASTBIT";
  EXPECT_EQ(b.put_part(upload_id, 0, p0, ""), "");
  EXPECT_EQ(b.put_part(upload_id, 1, p1, ""), "");
  EXPECT_EQ(b.multipart_received(upload_id), 2);

  const std::string final_key = "test_mp_final_0001";
  int64_t size = b.complete_multipart(upload_id, final_key);
  EXPECT_EQ(size, total);

  auto r = b.get(final_key);
  ASSERT_TRUE(r.ok);
  ASSERT_EQ(static_cast<int64_t>(r.data.size()), total);
  EXPECT_EQ(r.data.substr(0, 4), "AAAA");
  EXPECT_EQ(r.data.substr(static_cast<size_t>(part)), "LASTBIT");

  b.remove(final_key);
}

TEST_F(S3BackendLiveTest, AbortMultipart) {
  auto b = make_backend();
  const std::string upload_id = "test_abort_0001";
  ASSERT_TRUE(b.create_multipart(upload_id, 5 * 1024 * 1024, 1, 5 * 1024 * 1024));
  b.abort_multipart(upload_id);
  EXPECT_EQ(b.multipart_received(upload_id), -1);
}
