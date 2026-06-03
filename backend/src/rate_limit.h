#pragma once
#include <chrono>
#include <cmath>
#include <mutex>
#include <string>
#include <unordered_map>

// Shared token-bucket rate limiter for HTTP endpoints (brute-force / abuse
// protection on auth routes). Keyed by an arbitrary string (e.g. client IP, or
// IP+username). Thread-safe: auth credential checks run on the DB thread pool,
// so multiple threads may consume from the same limiter concurrently.
//
// Semantics: each key has a bucket of up to `burst` tokens that refills at
// `refill_per_sec` tokens/second. A request "costs" one token; when the bucket
// is empty the request is denied and a retry-after estimate is returned. This
// mirrors the per-connection token bucket already used by the WebSocket handler
// (ws_handler.cpp), but adds shared keyed storage + locking for the stateless
// HTTP path.
//
// The clock is injectable (defaults to steady_clock) so the bucket math is unit
// testable without sleeping. steady_clock is used so wall-clock changes don't
// perturb limiting.
class RateLimiter {
public:
  using Clock = std::chrono::steady_clock;

  // burst: bucket capacity (max attempts in a burst).
  // refill_per_sec: sustained attempts/second once the burst is spent.
  RateLimiter(double burst, double refill_per_sec)
    : burst_(burst), refill_per_sec_(refill_per_sec) {}

  // Attempt to consume one token for `key`. Returns true if allowed. On denial,
  // returns false and sets retry_ms_out to an estimated wait before one token
  // is available. `now` is injectable for testing.
  bool allow(const std::string& key, int& retry_ms_out, Clock::time_point now = Clock::now()) {
    std::lock_guard<std::mutex> lock(mutex_);

    // Opportunistic eviction so the map can't grow without bound: drop buckets
    // that have sat full (idle) long enough to be indistinguishable from a
    // fresh one. Cheap amortized sweep gated on map size.
    if (buckets_.size() > kEvictThreshold) {
      evict_idle(now);
    }

    auto& b = buckets_[key];
    if (b.last_refill.time_since_epoch().count() == 0) {
      // Newly inserted bucket starts full.
      b.tokens = burst_;
      b.last_refill = now;
    } else {
      double elapsed_s = std::chrono::duration<double>(now - b.last_refill).count();
      if (elapsed_s > 0) {
        b.tokens = std::min(burst_, b.tokens + elapsed_s * refill_per_sec_);
        b.last_refill = now;
      }
    }

    if (b.tokens >= 1.0) {
      b.tokens -= 1.0;
      retry_ms_out = 0;
      return true;
    }
    double need = 1.0 - b.tokens;
    retry_ms_out = static_cast<int>(std::ceil((need / refill_per_sec_) * 1000.0));
    return false;
  }

  // Refund a token for `key` (e.g. when an attempt turns out to be a success
  // and should not count against the limit). Never exceeds burst. Safe no-op if
  // the key is unknown.
  void refund(const std::string& key, Clock::time_point now = Clock::now()) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = buckets_.find(key);
    if (it == buckets_.end()) return;
    it->second.tokens = std::min(burst_, it->second.tokens + 1.0);
    it->second.last_refill = now;
  }

  // Drop all buckets that are full (no recent activity). Exposed for tests and
  // optional periodic maintenance.
  void evict_idle(Clock::time_point now = Clock::now()) {
    for (auto it = buckets_.begin(); it != buckets_.end();) {
      double elapsed_s = std::chrono::duration<double>(now - it->second.last_refill).count();
      double tokens = std::min(burst_, it->second.tokens + elapsed_s * refill_per_sec_);
      if (tokens >= burst_) {
        it = buckets_.erase(it);
      } else {
        ++it;
      }
    }
  }

  size_t size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return buckets_.size();
  }

private:
  struct Bucket {
    double tokens = 0.0;
    Clock::time_point last_refill{};  // zero => uninitialized (starts full)
  };

  static constexpr size_t kEvictThreshold = 10000;

  double burst_;
  double refill_per_sec_;
  mutable std::mutex mutex_;
  std::unordered_map<std::string, Bucket> buckets_;
};
