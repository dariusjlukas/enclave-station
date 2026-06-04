#include <gtest/gtest.h>
#include <cstdlib>
#include <string>

#if BACKEND_HAS_REDIS
#include <hiredis.h>
#include "redis/redis_connect.h"
#include "redis/redis_pubsub.h"
#endif

// Live test of redis_connect() against a real Redis. Skipped unless
// REDIS_TEST_URL is set. Used to verify AUTH (and, with a rediss:// URL, TLS).
namespace {
std::string envv(const char* n) {
  const char* v = std::getenv(n);
  return v ? v : "";
}
}  // namespace

#if BACKEND_HAS_REDIS
TEST(RedisConnectLive, ConnectsAndPublishesWithAuth) {
  std::string url = envv("REDIS_TEST_URL");
  if (url.empty()) GTEST_SKIP() << "REDIS_TEST_URL not set; skipping live Redis test";

  std::string err;
  redisContext* ctx = enclave_redis::redis_connect(url, 2, err);
  ASSERT_NE(ctx, nullptr) << "connect failed: " << err;

  // A PUBLISH proves we authenticated (an unauthenticated connection to a
  // password-protected server returns NOAUTH on any command).
  auto* reply = static_cast<redisReply*>(redisCommand(ctx, "PUBLISH %s %s", "test:chan", "hi"));
  ASSERT_NE(reply, nullptr);
  EXPECT_NE(reply->type, REDIS_REPLY_ERROR)
    << "PUBLISH errored: " << (reply->str ? reply->str : "");
  freeReplyObject(reply);
  redisFree(ctx);
}

TEST(RedisConnectLive, WrongPasswordFails) {
  std::string url = envv("REDIS_TEST_URL_BADPW");
  if (url.empty()) GTEST_SKIP() << "REDIS_TEST_URL_BADPW not set; skipping";
  std::string err;
  redisContext* ctx = enclave_redis::redis_connect(url, 2, err);
  EXPECT_EQ(ctx, nullptr);
  if (ctx) redisFree(ctx);
}

// Shared fixed-window counter: two independent RedisPubSub instances (modeling
// two backend replicas) incrementing the same key see a single global count —
// this is what makes the auth rate limit global across instances.
TEST(RedisConnectLive, SharedFixedWindowIsGlobalAcrossInstances) {
  std::string url = envv("REDIS_TEST_URL");
  if (url.empty()) GTEST_SKIP() << "REDIS_TEST_URL not set; skipping";

  // A unique key per run so repeated runs don't collide.
  // (No randomness available in tests; use a fixed key and clear it first.)
  const std::string key = "ratelimit:test:shared";
  {
    std::string err;
    redisContext* ctx = enclave_redis::redis_connect(url, 2, err);
    ASSERT_NE(ctx, nullptr) << err;
    auto* r = static_cast<redisReply*>(redisCommand(ctx, "DEL %s", key.c_str()));
    if (r) freeReplyObject(r);
    redisFree(ctx);
  }

  enclave_redis::RedisPubSub a(url, "instance-A", nullptr);
  enclave_redis::RedisPubSub b(url, "instance-B", nullptr);

  long long count = 0;
  // Interleave increments across the two "instances".
  ASSERT_TRUE(a.incr_fixed_window(key, 60, count));
  EXPECT_EQ(count, 1);
  ASSERT_TRUE(b.incr_fixed_window(key, 60, count));
  EXPECT_EQ(count, 2);  // global, not per-instance
  ASSERT_TRUE(a.incr_fixed_window(key, 60, count));
  EXPECT_EQ(count, 3);
  ASSERT_TRUE(b.incr_fixed_window(key, 60, count));
  EXPECT_EQ(count, 4);

  // Cleanup.
  std::string err;
  redisContext* ctx = enclave_redis::redis_connect(url, 2, err);
  if (ctx) {
    auto* r = static_cast<redisReply*>(redisCommand(ctx, "DEL %s", key.c_str()));
    if (r) freeReplyObject(r);
    redisFree(ctx);
  }
}
#endif
