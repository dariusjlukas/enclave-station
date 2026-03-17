#pragma once
#include <App.h>
#include <nlohmann/json.hpp>
#include "config.h"
#include "db/database.h"
#include "handlers/handler_utils.h"
#include "upload_manager.h"

using json = nlohmann::json;

template <bool SSL>
struct FileHandler {
  Database& db;
  const Config& config;
  UploadManager& uploads;
  uWS::TemplatedApp<SSL>* app_ = nullptr;

  void register_routes(uWS::TemplatedApp<SSL>& app);

private:
};
