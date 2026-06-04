#pragma once
#include <string>

#if BACKEND_HAS_REDIS
#include <hiredis.h>
#endif

namespace enclave_redis {

#if BACKEND_HAS_REDIS
// Connect to Redis from a URL, performing TLS negotiation (rediss://) and AUTH
// (user:pass@) as needed. On success returns a connected redisContext* (caller
// owns it, must redisFree). On failure returns nullptr and sets `err` to a
// human-readable reason. `connect_timeout_s` bounds the TCP connect.
//
// Implemented in redis_connect.cpp so the OpenSSL/hiredis_ssl dependency is
// localized.
redisContext* redis_connect(const std::string& url, int connect_timeout_s, std::string& err);
#endif

}  // namespace enclave_redis
