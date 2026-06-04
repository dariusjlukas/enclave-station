#include "redis/redis_publisher.h"

#include "logging/logger.h"
#include "metrics/metrics.h"
#include "redis/redis_envelope.h"

#if BACKEND_HAS_REDIS
#include <hiredis.h>
#include "redis/redis_connect.h"
#endif

#include <cstdlib>
#include <string>

namespace enclave_redis {

RedisPublisher::RedisPublisher(const std::string& url, const std::string& instance_id)
  : url_(url), instance_id_(instance_id), enabled_(!url.empty()) {
  if (!enabled_) {
    LOG_INFO_N("redis", nullptr, "RedisPublisher disabled (REDIS_URL is empty)");
  }
}

RedisPublisher::~RedisPublisher() {
  std::lock_guard<std::mutex> lock(mutex_);
  close_locked();
}

void RedisPublisher::close_locked() {
#if BACKEND_HAS_REDIS
  if (ctx_) {
    redisFree(ctx_);
    ctx_ = nullptr;
  }
#endif
}

bool RedisPublisher::ensure_connected_locked() {
#if BACKEND_HAS_REDIS
  if (ctx_ && !ctx_->err) return true;
  if (ctx_) {
    redisFree(ctx_);
    ctx_ = nullptr;
  }
  std::string err;
  ctx_ = redis_connect(url_, /*connect_timeout_s=*/2, err);
  if (!ctx_) {
    LOG_WARN_N("redis", nullptr, "RedisPublisher: connect failed: " + err);
    metrics::redis_health_check_failures_total().inc();
    metrics::redis_ok().set(0);
    return false;
  }
  return true;
#else
  return false;
#endif
}

bool RedisPublisher::publish(const std::string& topic, const std::string& payload) {
  if (!enabled_) return false;
#if BACKEND_HAS_REDIS
  Envelope env;
  env.instance_id = instance_id_;
  env.topic = topic;
  env.payload = payload;
  std::string encoded = env.encode();

  std::lock_guard<std::mutex> lock(mutex_);
  if (!ensure_connected_locked()) return false;

  // PUBLISH <channel> <payload>
  auto* reply = static_cast<redisReply*>(
    redisCommand(ctx_, "PUBLISH %s %b", kBroadcastChannel, encoded.data(), encoded.size()));
  if (!reply || ctx_->err) {
    std::string err = ctx_ ? ctx_->errstr : "no reply";
    LOG_WARN_N("redis", nullptr, "RedisPublisher: PUBLISH failed: " + err);
    if (reply) freeReplyObject(reply);
    close_locked();
    metrics::redis_health_check_failures_total().inc();
    metrics::redis_ok().set(0);
    return false;
  }
  freeReplyObject(reply);

  metrics::inc_redis_publish(topic_kind_from(topic));
  metrics::redis_ok().set(1);
  return true;
#else
  (void)topic;
  (void)payload;
  return false;
#endif
}

bool RedisPublisher::incr_fixed_window(
  const std::string& key, int window_seconds, long long& count_out) {
  if (!enabled_) return false;
#if BACKEND_HAS_REDIS
  std::lock_guard<std::mutex> lock(mutex_);
  if (!ensure_connected_locked()) return false;

  // INCR returns the new value; on the first increment (value == 1) set the
  // window TTL. Pipeline both commands to halve the round-trips.
  redisAppendCommand(ctx_, "INCR %s", key.c_str());
  redisAppendCommand(ctx_, "EXPIRE %s %d NX", key.c_str(), window_seconds);

  redisReply* incr_reply = nullptr;
  if (redisGetReply(ctx_, reinterpret_cast<void**>(&incr_reply)) != REDIS_OK || !incr_reply) {
    close_locked();
    metrics::redis_health_check_failures_total().inc();
    return false;
  }
  bool ok = incr_reply->type == REDIS_REPLY_INTEGER;
  if (ok) count_out = incr_reply->integer;
  freeReplyObject(incr_reply);

  // Drain the EXPIRE reply (best-effort; not fatal if it fails).
  redisReply* exp_reply = nullptr;
  if (redisGetReply(ctx_, reinterpret_cast<void**>(&exp_reply)) == REDIS_OK && exp_reply) {
    freeReplyObject(exp_reply);
  }

  if (!ok) {
    close_locked();
    metrics::redis_health_check_failures_total().inc();
    return false;
  }
  return true;
#else
  (void)key;
  (void)window_seconds;
  (void)count_out;
  return false;
#endif
}

}  // namespace enclave_redis
