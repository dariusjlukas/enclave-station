#pragma once
#include <App.h>
#include <atomic>
#include <memory>
#include <mutex>
#include <nlohmann/json.hpp>
#include <unordered_map>
#include "ai/tool_registry.h"
#include "config.h"
#include "db/database.h"
#include "db/db_thread_pool.h"
#include "ws/ws_handler.h"

using json = nlohmann::json;

template <bool SSL>
struct AiHandler {
  Database& db;
  const Config& config;
  WsHandler<SSL>& ws;
  ToolRegistry& tools;
  uWS::Loop* loop_;
  DbThreadPool& pool_;

  AiHandler(
    Database& db,
    const Config& config,
    WsHandler<SSL>& ws,
    ToolRegistry& tools,
    uWS::Loop* loop,
    DbThreadPool& pool)
    : db(db), config(config), ws(ws), tools(tools), loop_(loop), pool_(pool) {}

  void register_routes(uWS::TemplatedApp<SSL>& app);

private:
  std::string get_user_id(uWS::HttpResponse<SSL>* res, uWS::HttpRequest* req);
  bool check_llm_enabled(uWS::HttpResponse<SSL>* res, std::shared_ptr<bool> aborted);
  bool check_agent_enabled(
    uWS::HttpResponse<SSL>* res, std::shared_ptr<bool> aborted, const std::string& user_id);
  std::set<std::string> get_enabled_tool_categories(const std::string& user_id);
  std::string build_system_prompt(
    const std::string& user_id,
    const std::string& current_space_id,
    const std::string& current_channel_id);

  // Track in-progress generations for stop support
  std::mutex active_mutex_;
  std::unordered_map<std::string, std::shared_ptr<std::atomic<bool>>> active_generations_;
};
