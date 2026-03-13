#pragma once
#include <App.h>
#include <nlohmann/json.hpp>
#include "db/database.h"
#include "config.h"
#include "handlers/handler_utils.h"

using json = nlohmann::json;

template <bool SSL>
struct FileHandler {
    Database& db;
    const Config& config;
    uWS::TemplatedApp<SSL>* app_ = nullptr;

    void register_routes(uWS::TemplatedApp<SSL>& app);

    // Public static utilities (pure functions, used by tests)
    static std::string format_size(int64_t bytes);
    static std::string random_hex(int bytes);

private:
};
