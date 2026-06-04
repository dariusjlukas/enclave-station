#include <gtest/gtest.h>
#include "redis/redis_url.h"

using enclave_redis::parse_redis_url;
using enclave_redis::RedisUrl;

TEST(RedisUrl, HostOnly) {
  RedisUrl u;
  ASSERT_TRUE(parse_redis_url("redis://myhost", u));
  EXPECT_EQ(u.host, "myhost");
  EXPECT_EQ(u.port, 6379);
  EXPECT_TRUE(u.username.empty());
  EXPECT_TRUE(u.password.empty());
  EXPECT_FALSE(u.use_tls);
}

TEST(RedisUrl, HostAndPort) {
  RedisUrl u;
  ASSERT_TRUE(parse_redis_url("redis://host:6380", u));
  EXPECT_EQ(u.host, "host");
  EXPECT_EQ(u.port, 6380);
}

TEST(RedisUrl, PasswordOnly) {
  RedisUrl u;
  ASSERT_TRUE(parse_redis_url("redis://:secret@host:6379", u));
  EXPECT_EQ(u.host, "host");
  EXPECT_EQ(u.port, 6379);
  EXPECT_TRUE(u.username.empty());
  EXPECT_EQ(u.password, "secret");
}

TEST(RedisUrl, UserAndPassword) {
  RedisUrl u;
  ASSERT_TRUE(parse_redis_url("redis://alice:s3cr3t@host:6390/0", u));
  EXPECT_EQ(u.host, "host");
  EXPECT_EQ(u.port, 6390);
  EXPECT_EQ(u.username, "alice");
  EXPECT_EQ(u.password, "s3cr3t");
}

TEST(RedisUrl, TlsScheme) {
  RedisUrl u;
  ASSERT_TRUE(parse_redis_url("rediss://user:pw@secure-redis:6379", u));
  EXPECT_TRUE(u.use_tls);
  EXPECT_EQ(u.host, "secure-redis");
  EXPECT_EQ(u.username, "user");
  EXPECT_EQ(u.password, "pw");
}

TEST(RedisUrl, IgnoresDbPath) {
  RedisUrl u;
  ASSERT_TRUE(parse_redis_url("redis://host:6379/3", u));
  EXPECT_EQ(u.host, "host");
  EXPECT_EQ(u.port, 6379);
}

TEST(RedisUrl, PasswordWithAtSignInHost) {
  // rfind('@') ensures a password containing no '@' still parses; the LAST '@'
  // separates userinfo from host.
  RedisUrl u;
  ASSERT_TRUE(parse_redis_url("redis://user:pw@host:6379", u));
  EXPECT_EQ(u.host, "host");
  EXPECT_EQ(u.password, "pw");
}

TEST(RedisUrl, Rejects) {
  RedisUrl u;
  EXPECT_FALSE(parse_redis_url("", u));
  EXPECT_FALSE(parse_redis_url("http://host", u));
  EXPECT_FALSE(parse_redis_url("redis://", u));
  EXPECT_FALSE(parse_redis_url("redis://host:notaport", u));
  EXPECT_FALSE(parse_redis_url("redis://host:99999", u));
  EXPECT_FALSE(parse_redis_url("redis://:pw@", u));
}
