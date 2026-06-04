#pragma once
#include <App.h>
#include <nlohmann/json.hpp>
#include "config.h"
#include "db/database.h"
#include "db/db_thread_pool.h"
#include "handlers/handler_utils.h"
#include "storage/storage_backend.h"
#include "upload_manager.h"
#include "ws/ws_handler.h"

using json = nlohmann::json;

template <bool SSL>
struct FileHandler {
  Database& db;
  const Config& config;
  UploadManager& uploads;
  WsHandler<SSL>& ws;
  storage::StorageBackend& storage;
  uWS::TemplatedApp<SSL>* app_ = nullptr;
  uWS::Loop* loop_ = nullptr;
  DbThreadPool* pool_ = nullptr;

  void register_routes(uWS::TemplatedApp<SSL>& app);

private:
};
