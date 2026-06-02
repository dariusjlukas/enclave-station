#pragma once
#include <App.h>
#include <memory>
#include <nlohmann/json.hpp>
#include "config.h"
#include "db/database.h"
#include "db/db_thread_pool.h"
#include "handlers/handler_utils.h"

using json = nlohmann::json;

template <bool SSL>
struct TaskBoardHandler {
  Database& db;
  const Config& config;
  uWS::Loop* loop_;
  DbThreadPool& pool_;

  void register_routes(uWS::TemplatedApp<SSL>& app);

private:
  std::string get_user_id(
    uWS::HttpResponse<SSL>* res,
    const std::shared_ptr<bool>& aborted,
    const std::string& token,
    const std::string& origin);
  bool check_space_access(
    uWS::HttpResponse<SSL>* res,
    const std::shared_ptr<bool>& aborted,
    const std::string& space_id,
    const std::string& user_id,
    const std::string& origin);
  std::string get_access_level(const std::string& space_id, const std::string& user_id);
  // Verify the board named in the URL belongs to the space named in the URL.
  // Emits a 404 and returns false on mismatch. Guards against acting on another
  // space's board (cross-space IDOR via the :boardId path parameter).
  bool require_board_in_space(
    uWS::HttpResponse<SSL>* res,
    const std::shared_ptr<bool>& aborted,
    const std::string& space_id,
    const std::string& board_id,
    const std::string& origin);
  // Verify a task sub-resource (column/task/checklist/item/label/dependency),
  // identified by its resolved owning board id, belongs to the space named in
  // the URL (which the caller has already been authorized for). Emits a 404 and
  // returns false when the resource does not exist (resource_board_id ==
  // nullopt) or its board lives in a different space. This is the chain check
  // that prevents cross-space IDOR via body/path-supplied resource IDs.
  bool require_resource_in_space(
    uWS::HttpResponse<SSL>* res,
    const std::shared_ptr<bool>& aborted,
    const std::string& space_id,
    const std::optional<std::string>& resource_board_id,
    const std::string& origin);
  bool require_permission(
    uWS::HttpResponse<SSL>* res,
    const std::shared_ptr<bool>& aborted,
    const std::string& space_id,
    const std::string& user_id,
    const std::string& required_level,
    const std::string& origin);
  static int perm_rank(const std::string& p);
};
