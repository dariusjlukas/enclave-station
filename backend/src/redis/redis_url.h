#pragma once
#include <cstdlib>
#include <string>

namespace enclave_redis {

// Parsed Redis connection URL.
//   redis://[user:password@]host[:port][/db]
//   rediss://[user:password@]host[:port][/db]   (TLS)
struct RedisUrl {
  std::string host;
  int port = 6379;
  std::string username;  // empty unless provided (Redis 6 ACL user)
  std::string password;  // empty unless provided
  bool use_tls = false;  // true for rediss://
};

// Parse `url` into `out`. Returns false on malformed input. Supports an optional
// userinfo (user:pass@ or :pass@), an optional port, and an ignored /db path.
inline bool parse_redis_url(const std::string& url, RedisUrl& out) {
  std::string rest;
  if (url.rfind("rediss://", 0) == 0) {
    out.use_tls = true;
    rest = url.substr(9);
  } else if (url.rfind("redis://", 0) == 0) {
    out.use_tls = false;
    rest = url.substr(8);
  } else {
    return false;
  }

  // Strip trailing path/db ("/0").
  auto slash = rest.find('/');
  if (slash != std::string::npos) rest = rest.substr(0, slash);
  if (rest.empty()) return false;

  // Optional userinfo before '@'.
  auto at = rest.rfind('@');
  if (at != std::string::npos) {
    std::string userinfo = rest.substr(0, at);
    rest = rest.substr(at + 1);
    auto colon = userinfo.find(':');
    if (colon == std::string::npos) {
      // "password@" form (no username) is not standard; treat whole thing as
      // password to be lenient, leaving username empty.
      out.password = userinfo;
    } else {
      out.username = userinfo.substr(0, colon);
      out.password = userinfo.substr(colon + 1);
    }
  }

  if (rest.empty()) return false;
  auto colon = rest.find(':');
  if (colon == std::string::npos) {
    out.host = rest;
    out.port = 6379;
    return !out.host.empty();
  }
  out.host = rest.substr(0, colon);
  if (out.host.empty()) return false;
  std::string port_str = rest.substr(colon + 1);
  if (port_str.empty()) return false;
  char* end = nullptr;
  long p = std::strtol(port_str.c_str(), &end, 10);
  if (end == port_str.c_str() || *end != '\0' || p <= 0 || p > 65535) return false;
  out.port = static_cast<int>(p);
  return true;
}

}  // namespace enclave_redis
