#pragma once
#include <App.h>
#include <openssl/rand.h>
#include <nlohmann/json.hpp>
#include "auth/password.h"
#include "auth/totp.h"
#include "auth/webauthn.h"
#include "config.h"
#include "db/database.h"
#include "handlers/handler_utils.h"
#include "ws/ws_handler.h"

using json = nlohmann::json;

template <bool SSL>
struct AuthHandler {
  Database& db;
  const Config& config;
  WsHandler<SSL>& ws;

  void register_routes(uWS::TemplatedApp<SSL>& app);

private:
  bool is_method_enabled(const std::string& method);
  int get_session_expiry();
  bool is_mfa_required_for_method(const std::string& method);
  bool check_and_handle_mfa(
    uWS::HttpResponse<SSL>* res, const User& user, const std::string& auth_method);
  std::string check_registration_eligibility(
    const std::string& username, const std::string& invite_token);
  void complete_user_creation(User& user, const std::string& invite_token);
  std::string generate_user_handle();
  json make_user_json(const User& user);

  // WebAuthn (passkey) handlers
  void handle_register_options(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_register_verify(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_login_options(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_login_verify(uWS::HttpResponse<SSL>* res, const std::string& body);

  // PKI (browser key) handlers
  void handle_pki_challenge(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_pki_register(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_pki_login(uWS::HttpResponse<SSL>* res, const std::string& body);

  // Device linking handlers
  void handle_add_device_pki(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_add_device_passkey_options(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_add_device_passkey_verify(uWS::HttpResponse<SSL>* res, const std::string& body);

  // Recovery handlers
  void handle_recovery_login(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_recovery_token_login(uWS::HttpResponse<SSL>* res, const std::string& body);

  // Join request handlers
  void handle_request_access_options(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_request_access(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_request_status(uWS::HttpResponse<SSL>* res, const std::string& request_id);

  // Password auth handlers
  password_auth::PasswordPolicy get_password_policy();
  void handle_password_register(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_password_login(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_password_change(
    uWS::HttpResponse<SSL>* res, const std::string& body, const std::string& session_token);
  void handle_password_set(
    uWS::HttpResponse<SSL>* res, const std::string& body, const std::string& session_token);
  void handle_password_delete(uWS::HttpResponse<SSL>* res, const std::string& session_token);

  // MFA handlers
  void handle_mfa_verify(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_mfa_setup(uWS::HttpResponse<SSL>* res, const std::string& body);
  void handle_mfa_setup_verify(uWS::HttpResponse<SSL>* res, const std::string& body);
};
