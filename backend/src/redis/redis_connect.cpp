#include "redis/redis_connect.h"

#if BACKEND_HAS_REDIS
#include <hiredis.h>
#if BACKEND_HAS_REDIS_SSL
#include <hiredis_ssl.h>
#endif
#include <sys/time.h>
#include <mutex>
#include "redis/redis_url.h"

namespace enclave_redis {

namespace {
#if BACKEND_HAS_REDIS_SSL
// hiredis requires a one-time global init of the OpenSSL bits before creating
// SSL contexts.
void ensure_ssl_init() {
  static std::once_flag once;
  std::call_once(once, []() { redisInitOpenSSL(); });
}
#endif

// Issue AUTH if a password is present. Returns true on success (or when no auth
// is needed). On failure, sets `err`.
bool do_auth(redisContext* ctx, const RedisUrl& u, std::string& err) {
  if (u.password.empty()) return true;
  redisReply* reply = nullptr;
  if (u.username.empty()) {
    reply = static_cast<redisReply*>(redisCommand(ctx, "AUTH %s", u.password.c_str()));
  } else {
    reply = static_cast<redisReply*>(
      redisCommand(ctx, "AUTH %s %s", u.username.c_str(), u.password.c_str()));
  }
  if (!reply) {
    err = "AUTH command failed (no reply)";
    return false;
  }
  bool ok = reply->type != REDIS_REPLY_ERROR;
  if (!ok) err = std::string("AUTH rejected: ") + (reply->str ? reply->str : "error");
  freeReplyObject(reply);
  return ok;
}
}  // namespace

redisContext* redis_connect(const std::string& url, int connect_timeout_s, std::string& err) {
  RedisUrl u;
  if (!parse_redis_url(url, u)) {
    err = "malformed REDIS_URL";
    return nullptr;
  }

  struct timeval tv = {connect_timeout_s, 0};
  redisContext* ctx = redisConnectWithTimeout(u.host.c_str(), u.port, tv);
  if (!ctx || ctx->err) {
    err = ctx ? ctx->errstr : "alloc failed";
    if (ctx) redisFree(ctx);
    return nullptr;
  }

  if (u.use_tls) {
#if BACKEND_HAS_REDIS_SSL
    ensure_ssl_init();
    redisSSLContextError ssl_err = REDIS_SSL_CTX_NONE;
    // Verify the server cert against the system trust store; SNI = host.
    redisSSLContext* ssl_ctx =
      redisCreateSSLContext(nullptr, nullptr, nullptr, nullptr, u.host.c_str(), &ssl_err);
    if (!ssl_ctx) {
      err = std::string("TLS context init failed: ") + redisSSLContextGetError(ssl_err);
      redisFree(ctx);
      return nullptr;
    }
    if (redisInitiateSSLWithContext(ctx, ssl_ctx) != REDIS_OK) {
      err = std::string("TLS handshake failed: ") + (ctx->errstr[0] ? ctx->errstr : "unknown");
      redisFreeSSLContext(ssl_ctx);
      redisFree(ctx);
      return nullptr;
    }
    // The context is associated with the connection for its lifetime; hiredis
    // does not take ownership, so we intentionally leak the SSL context here.
    // It is small and lives as long as the process's connection. (Freeing it
    // while the connection is open would break TLS.) We keep it simple rather
    // than tracking per-connection SSL contexts for cleanup.
#else
    err = "rediss:// (TLS) requested but TLS support was not compiled in";
    redisFree(ctx);
    return nullptr;
#endif
  }

  if (!do_auth(ctx, u, err)) {
    redisFree(ctx);
    return nullptr;
  }

  return ctx;
}

}  // namespace enclave_redis
#endif  // BACKEND_HAS_REDIS
