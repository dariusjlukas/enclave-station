#include <gtest/gtest.h>
#include <chrono>
#include "rate_limit.h"

using Clock = RateLimiter::Clock;

// A fixed base time so tests are deterministic (steady_clock has no fixed
// epoch, but arithmetic on a captured base point is stable).
static Clock::time_point base() {
  static Clock::time_point t = Clock::now();
  return t;
}

TEST(RateLimiterTest, AllowsUpToBurstThenDenies) {
  RateLimiter rl(5.0, 1.0);  // burst 5, refill 1/sec
  auto now = base();
  int retry = 0;
  for (int i = 0; i < 5; i++) {
    EXPECT_TRUE(rl.allow("ip", retry, now)) << "attempt " << i << " should be allowed";
  }
  // 6th in the same instant is denied.
  EXPECT_FALSE(rl.allow("ip", retry, now));
  EXPECT_GT(retry, 0);
}

TEST(RateLimiterTest, RefillsOverTime) {
  RateLimiter rl(2.0, 1.0);  // burst 2, refill 1/sec
  auto now = base();
  int retry = 0;
  EXPECT_TRUE(rl.allow("ip", retry, now));
  EXPECT_TRUE(rl.allow("ip", retry, now));
  EXPECT_FALSE(rl.allow("ip", retry, now));  // bucket empty

  // After 1 second, one token has refilled.
  EXPECT_TRUE(rl.allow("ip", retry, now + std::chrono::seconds(1)));
  EXPECT_FALSE(rl.allow("ip", retry, now + std::chrono::seconds(1)));
}

TEST(RateLimiterTest, KeysAreIndependent) {
  RateLimiter rl(1.0, 1.0);  // burst 1
  auto now = base();
  int retry = 0;
  EXPECT_TRUE(rl.allow("a", retry, now));
  EXPECT_FALSE(rl.allow("a", retry, now));  // a exhausted
  EXPECT_TRUE(rl.allow("b", retry, now));   // b independent
  EXPECT_FALSE(rl.allow("b", retry, now));
}

TEST(RateLimiterTest, RetryEstimateIsBoundedByRefill) {
  RateLimiter rl(1.0, 2.0);  // refill 2/sec => one token in 500ms
  auto now = base();
  int retry = 0;
  EXPECT_TRUE(rl.allow("ip", retry, now));
  EXPECT_FALSE(rl.allow("ip", retry, now));
  // Needs ~1 token at 2/sec => ~500ms.
  EXPECT_GE(retry, 400);
  EXPECT_LE(retry, 600);
}

TEST(RateLimiterTest, RefundReturnsAToken) {
  RateLimiter rl(1.0, 0.001);  // burst 1, negligible refill
  auto now = base();
  int retry = 0;
  EXPECT_TRUE(rl.allow("ip", retry, now));
  EXPECT_FALSE(rl.allow("ip", retry, now));  // empty
  rl.refund("ip", now);
  EXPECT_TRUE(rl.allow("ip", retry, now));  // refunded token usable
}

TEST(RateLimiterTest, NeverExceedsBurstAfterLongIdle) {
  RateLimiter rl(3.0, 1000.0);  // huge refill
  auto now = base();
  int retry = 0;
  // Even after a long idle, only `burst` requests succeed back-to-back at a
  // single instant (tokens cap at burst).
  for (int i = 0; i < 3; i++) {
    EXPECT_TRUE(rl.allow("ip", retry, now + std::chrono::hours(1)));
  }
  EXPECT_FALSE(rl.allow("ip", retry, now + std::chrono::hours(1)));
}

TEST(RateLimiterTest, EvictIdleDropsFullBuckets) {
  RateLimiter rl(2.0, 1000.0);
  auto now = base();
  int retry = 0;
  rl.allow("ip", retry, now);  // creates a bucket, now partially spent
  EXPECT_EQ(rl.size(), 1u);
  // After enough time the bucket refills to full and becomes evictable.
  rl.evict_idle(now + std::chrono::seconds(10));
  EXPECT_EQ(rl.size(), 0u);
}
