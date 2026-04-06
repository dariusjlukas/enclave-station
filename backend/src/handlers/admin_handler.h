#pragma once
#include <App.h>
#include <memory>
#include <nlohmann/json.hpp>
#include "config.h"
#include "db/database.h"
#include "db/db_thread_pool.h"
#include "handlers/handler_utils.h"
#include "ws/ws_handler.h"

using json = nlohmann::json;

template <bool SSL>
struct AdminHandler {
  Database& db;
  const Config& config;
  WsHandler<SSL>& ws;
  uWS::Loop* loop_;
  DbThreadPool& pool_;

  void register_routes(uWS::TemplatedApp<SSL>& app);

private:
  std::string get_admin_id(
    uWS::HttpResponse<SSL>* res, const std::string& token, std::shared_ptr<bool> aborted);
  std::string get_owner_id(
    uWS::HttpResponse<SSL>* res, const std::string& token, std::shared_ptr<bool> aborted);
  std::string get_setting_or(const std::string& key, const std::string& fallback);
  json build_settings_response();
  void save_settings(
    uWS::HttpResponse<SSL>* res,
    const std::string& body,
    std::shared_ptr<bool> aborted,
    bool mark_setup = false);
  int get_session_expiry_hours();
  void handle_approve(
    uWS::HttpResponse<SSL>* res,
    const std::string& request_id,
    const std::string& admin_id,
    std::shared_ptr<bool> aborted);
};
