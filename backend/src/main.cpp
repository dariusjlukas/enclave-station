#include <App.h>
#include <iostream>
#include "config.h"
#include "db/database.h"
#include "handlers/auth_handler.h"
#include "handlers/channel_handler.h"
#include "handlers/user_handler.h"
#include "handlers/admin_handler.h"
#include "ws/ws_handler.h"

int main() {
    std::cout << "=== Chat Server ===" << std::endl;

    auto config = Config::from_env();
    std::cout << "[Config] Port: " << config.server_port << std::endl;

    // Connect to database
    Database db(config.pg_connection_string());
    db.run_migrations();

    // Create handlers
    WsHandler ws_handler(db);
    AuthHandler auth_handler{db, config};
    ChannelHandler channel_handler{db, ws_handler};
    UserHandler user_handler{db};
    AdminHandler admin_handler{db, config};

    // Build server
    uWS::App app;

    // CORS preflight
    app.options("/*", [](auto* res, auto* req) {
        res->writeHeader("Access-Control-Allow-Origin", "*")
            ->writeHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            ->writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
            ->writeStatus("204")->end();
    });

    // Register routes
    auth_handler.register_routes(app);
    channel_handler.register_routes(app);
    user_handler.register_routes(app);
    admin_handler.register_routes(app);
    ws_handler.register_routes(app);

    // Public config (non-sensitive settings for the frontend)
    app.get("/api/config", [&config](auto* res, auto* req) {
        json resp;
        resp["public_url"] = config.public_url;
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(resp.dump());
    });

    // Health check
    app.get("/api/health", [](auto* res, auto* req) {
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"status":"ok"})");
    });

    // Start listening
    app.listen(config.server_port, [&config](auto* listen_socket) {
        if (listen_socket) {
            std::cout << "[Server] Listening on port " << config.server_port << std::endl;
        } else {
            std::cerr << "[Server] Failed to listen on port " << config.server_port << std::endl;
            exit(1);
        }
    }).run();

    return 0;
}
