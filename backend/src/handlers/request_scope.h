#pragma once
#include <App.h>
#include <chrono>
#include <memory>
#include <string>
#include <string_view>
#include "logging/logger.h"
#include "metrics/metrics.h"

namespace handler_utils {

// Bundles a request-id (for logs), a metrics RequestTimer (for /metrics),
// and the basic request context. One instance is created at the top of
// each route handler and captured via std::shared_ptr into any async
// continuations. Call observe(status) before the final response write.
struct RequestScope {
  logging::RequestCtx ctx;
  metrics::RequestTimer timer;
  std::string method;
  std::string route;

  RequestScope(std::string method_in, std::string route_in)
    : ctx{logging::make_request_id(), "", method_in, route_in},
      timer(method_in, route_in),
      method(std::move(method_in)),
      route(std::move(route_in)) {}

  void observe(int status) {
    timer.observe(status);
  }
  void set_user(const std::string& user_id) {
    ctx.user_id = user_id;
  }
};

// NOTE: An X-Request-Id *response* header was intentionally removed here. In
// uWebSockets the first writeHeader() call commits the status line as "200 OK",
// so writing X-Request-Id at the top of a handler (before the response's own
// writeStatus("4xx")) silently forced every error response to HTTP 200. The
// request id is still emitted in server logs via RequestCtx (see logger.cpp).
// To return it to clients, write it AFTER writeStatus() in each response.

}  // namespace handler_utils
