#pragma once
#include <App.h>
#include <nlohmann/json.hpp>
#include "db/database.h"
#include "handlers/handler_utils.h"

using json = nlohmann::json;

template <bool SSL>
struct SearchHandler {
    Database& db;

    void register_routes(uWS::TemplatedApp<SSL>& app);

    // Public static utilities (pure functions, used by tests)
    static std::vector<std::string> split_terms(const std::string& input);
    static std::string build_tsquery(const std::vector<std::string>& terms,
                                      const std::string& mode,
                                      const std::string& config = "english");
    static std::string quote_literal(const std::string& s);
    static std::vector<Database::CompositeFilter> parse_filters(const std::string& input);

private:
    std::string get_user_id(uWS::HttpResponse<SSL>* res, uWS::HttpRequest* req);
};
