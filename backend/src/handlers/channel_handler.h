#pragma once
#include <App.h>
#include <nlohmann/json.hpp>
#include <unordered_set>
#include "db/database.h"
#include "handlers/handler_utils.h"
#include "ws/ws_handler.h"

using json = nlohmann::json;

template <bool SSL>
struct ChannelHandler {
  Database& db;
  WsHandler<SSL>& ws;

  void register_routes(uWS::TemplatedApp<SSL>& app);

private:
  std::string get_user_id(uWS::HttpResponse<SSL>* res, uWS::HttpRequest* req);
  void handle_create_channel(
    uWS::HttpResponse<SSL>* res, const std::string& body, const std::string& user_id);
  void handle_create_dm(
    uWS::HttpResponse<SSL>* res, const std::string& body, const std::string& user_id);
};
