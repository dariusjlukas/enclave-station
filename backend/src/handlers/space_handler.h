#pragma once
#include <App.h>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <nlohmann/json.hpp>
#include <random>
#include <sstream>
#include "config.h"
#include "db/database.h"
#include "handlers/handler_utils.h"
#include "ws/ws_handler.h"

using json = nlohmann::json;

template <bool SSL>
struct SpaceHandler {
  Database& db;
  WsHandler<SSL>& ws;
  const Config& config;

  void register_routes(uWS::TemplatedApp<SSL>& app);

private:
  std::string get_user_id(uWS::HttpResponse<SSL>* res, uWS::HttpRequest* req);
};
