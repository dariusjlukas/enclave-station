#pragma once
#include <App.h>
#include <nlohmann/json.hpp>
#include "db/database.h"
#include "handlers/handler_utils.h"

using json = nlohmann::json;

template <bool SSL>
struct NotificationHandler {
  Database& db;

  void register_routes(uWS::TemplatedApp<SSL>& app);
};
