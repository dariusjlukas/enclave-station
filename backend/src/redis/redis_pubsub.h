#pragma once

#include <string>

#include "redis/redis_publisher.h"
#include "redis/redis_subscriber.h"

namespace enclave_redis {

// Owns a Publisher + Subscriber pair. This is the single object the rest of
// the app interacts with — WsHandler will hold a pointer to one of these
// (or nullptr in single-instance mode).
class RedisPubSub {
public:
  using DispatchFn = RedisSubscriber::DispatchFn;

  // url: "redis://..." or empty (disables both publisher and subscriber).
  // instance_id: stable UUID identifying this process; used for self-echo
  // filtering. dispatch: invoked on the subscriber thread for every
  // non-self envelope received from Redis. The caller must bounce through
  // loop->defer() if dispatch needs to touch event-loop-owned state.
  RedisPubSub(const std::string& url, const std::string& instance_id, DispatchFn dispatch);
  ~RedisPubSub();

  RedisPubSub(const RedisPubSub&) = delete;
  RedisPubSub& operator=(const RedisPubSub&) = delete;

  // Spawns the subscriber thread (no-op if disabled or already started).
  void start();

  // Synchronous PUBLISH. No-op (returns false) if disabled.
  bool publish(const std::string& topic, const std::string& payload);

  // Shared fixed-window counter for cross-instance rate limiting. See
  // RedisPublisher::incr_fixed_window.
  bool incr_fixed_window(const std::string& key, int window_seconds, long long& count_out) {
    return publisher_.incr_fixed_window(key, window_seconds, count_out);
  }

  bool is_enabled() const {
    return publisher_.is_enabled();
  }

private:
  RedisPublisher publisher_;
  RedisSubscriber subscriber_;
};

}  // namespace enclave_redis
