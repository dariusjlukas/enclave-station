#include "handlers/task_board_handler.h"
#include <pqxx/pqxx>

using json = nlohmann::json;

static json board_to_json(const TaskBoard& b) {
    return {
        {"id", b.id}, {"space_id", b.space_id},
        {"name", b.name}, {"description", b.description},
        {"created_by", b.created_by},
        {"created_by_username", b.created_by_username},
        {"created_at", b.created_at}, {"updated_at", b.updated_at}
    };
}

static json column_to_json(const TaskColumn& c) {
    return {
        {"id", c.id}, {"board_id", c.board_id},
        {"name", c.name}, {"position", c.position},
        {"wip_limit", c.wip_limit}, {"color", c.color},
        {"created_at", c.created_at}
    };
}

static json task_to_json(const Task& t) {
    return {
        {"id", t.id}, {"board_id", t.board_id}, {"column_id", t.column_id},
        {"title", t.title}, {"description", t.description},
        {"priority", t.priority}, {"due_date", t.due_date},
        {"start_date", t.start_date}, {"duration_days", t.duration_days},
        {"color", t.color}, {"position", t.position},
        {"created_by", t.created_by},
        {"created_by_username", t.created_by_username},
        {"created_at", t.created_at}, {"updated_at", t.updated_at}
    };
}

static json dependency_to_json(const TaskDependency& d) {
    return {
        {"id", d.id}, {"task_id", d.task_id},
        {"depends_on_id", d.depends_on_id},
        {"dependency_type", d.dependency_type},
        {"created_at", d.created_at}
    };
}

static json assignee_to_json(const TaskAssignee& a) {
    return {
        {"user_id", a.user_id}, {"username", a.username},
        {"display_name", a.display_name}
    };
}

static json label_to_json(const TaskLabel& l) {
    return {
        {"id", l.id}, {"board_id", l.board_id},
        {"name", l.name}, {"color", l.color}
    };
}

static json checklist_to_json(const TaskChecklist& cl) {
    return {
        {"id", cl.id}, {"task_id", cl.task_id},
        {"title", cl.title}, {"position", cl.position}
    };
}

static json checklist_item_to_json(const TaskChecklistItem& item) {
    return {
        {"id", item.id}, {"checklist_id", item.checklist_id},
        {"content", item.content}, {"is_checked", item.is_checked},
        {"position", item.position}
    };
}

static json activity_to_json(const TaskActivity& a) {
    return {
        {"id", a.id}, {"task_id", a.task_id},
        {"user_id", a.user_id}, {"username", a.username},
        {"display_name", a.display_name},
        {"action", a.action}, {"details", a.details},
        {"created_at", a.created_at}
    };
}

static json permission_to_json(const TaskBoardPermission& p) {
    return {
        {"id", p.id}, {"space_id", p.space_id},
        {"user_id", p.user_id}, {"username", p.username},
        {"display_name", p.display_name}, {"permission", p.permission},
        {"granted_by", p.granted_by},
        {"granted_by_username", p.granted_by_username},
        {"created_at", p.created_at}
    };
}

template <bool SSL>
void TaskBoardHandler<SSL>::register_routes(uWS::TemplatedApp<SSL>& app) {

    // --- Boards ---

    // List boards
    app.get("/api/spaces/:id/tasks/boards", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        if (!check_space_access(res, space_id, user_id)) return;

        auto boards = db.list_task_boards(space_id);
        std::string my_perm = get_access_level(space_id, user_id);

        json arr = json::array();
        for (const auto& b : boards) arr.push_back(board_to_json(b));

        json resp = {{"boards", arr}, {"my_permission", my_perm}};
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(resp.dump());
    });

    // Create board
    app.post("/api/spaces/:id/tasks/boards", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                std::string name = j.at("name");
                std::string description = j.value("description", "");

                if (name.empty() || name.length() > 255) {
                    res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                        ->writeHeader("Access-Control-Allow-Origin", "*")
                        ->end(R"json({"error":"Name is required (max 255 characters)"})json");
                    return;
                }

                auto board = db.create_task_board(space_id, name, description, user_id);
                auto creator = db.find_user_by_id(user_id);
                board.created_by_username = creator ? creator->username : "";

                // Create default columns
                db.create_task_column(board.id, "To Do", 0, 0, "");
                db.create_task_column(board.id, "In Progress", 1, 0, "");
                db.create_task_column(board.id, "Done", 2, 0, "");

                json resp = board_to_json(board);
                resp["columns"] = json::array();
                auto cols = db.list_task_columns(board.id);
                for (const auto& c : cols) resp["columns"].push_back(column_to_json(c));

                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(resp.dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Get board with columns and tasks
    app.get("/api/spaces/:id/tasks/boards/:boardId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        if (!check_space_access(res, space_id, user_id)) return;

        auto board = db.find_task_board(board_id);
        if (!board || board->space_id != space_id) {
            res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                ->writeHeader("Access-Control-Allow-Origin", "*")
                ->end(R"({"error":"Board not found"})");
            return;
        }

        json resp = board_to_json(*board);
        resp["my_permission"] = get_access_level(space_id, user_id);

        // Include columns
        auto columns = db.list_task_columns(board_id);
        json cols_arr = json::array();
        for (const auto& c : columns) cols_arr.push_back(column_to_json(c));
        resp["columns"] = cols_arr;

        // Include all tasks with their assignees and labels
        auto tasks = db.list_tasks(board_id);
        json tasks_arr = json::array();
        for (const auto& t : tasks) {
            json tj = task_to_json(t);
            auto assignees = db.get_task_assignees(t.id);
            json assignees_arr = json::array();
            for (const auto& a : assignees) assignees_arr.push_back(assignee_to_json(a));
            tj["assignees"] = assignees_arr;

            auto labels = db.get_task_labels(t.id);
            json labels_arr = json::array();
            for (const auto& l : labels) labels_arr.push_back(label_to_json(l));
            tj["labels"] = labels_arr;

            tasks_arr.push_back(tj);
        }
        resp["tasks"] = tasks_arr;

        // Include board labels
        auto board_labels = db.list_task_labels(board_id);
        json bl_arr = json::array();
        for (const auto& l : board_labels) bl_arr.push_back(label_to_json(l));
        resp["board_labels"] = bl_arr;

        // Include dependencies
        auto deps = db.get_task_dependencies(board_id);
        json deps_arr = json::array();
        for (const auto& d : deps) deps_arr.push_back(dependency_to_json(d));
        resp["dependencies"] = deps_arr;

        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(resp.dump());
    });

    // Update board
    app.put("/api/spaces/:id/tasks/boards/:boardId", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            auto existing = db.find_task_board(board_id);
            if (!existing || existing->space_id != space_id) {
                res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(R"({"error":"Board not found"})");
                return;
            }

            try {
                auto j = json::parse(body);
                std::string name = j.value("name", existing->name);
                std::string description = j.value("description", existing->description);

                auto board = db.update_task_board(board_id, name, description);
                auto creator = db.find_user_by_id(board.created_by);
                board.created_by_username = creator ? creator->username : "";

                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(board_to_json(board).dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Delete board
    app.del("/api/spaces/:id/tasks/boards/:boardId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        if (!check_space_access(res, space_id, user_id)) return;

        auto board = db.find_task_board(board_id);
        if (!board || board->space_id != space_id) {
            res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                ->writeHeader("Access-Control-Allow-Origin", "*")
                ->end(R"({"error":"Board not found"})");
            return;
        }

        if (board->created_by != user_id) {
            if (!require_permission(res, space_id, user_id, "owner")) return;
        }

        db.delete_task_board(board_id);
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"ok":true})");
    });

    // --- Columns ---

    // Create column
    app.post("/api/spaces/:id/tasks/boards/:boardId/columns", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            auto board = db.find_task_board(board_id);
            if (!board || board->space_id != space_id) {
                res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(R"({"error":"Board not found"})");
                return;
            }

            try {
                auto j = json::parse(body);
                std::string name = j.at("name");
                int position = j.value("position", 999);
                int wip_limit = j.value("wip_limit", 0);
                std::string color = j.value("color", "");

                auto col = db.create_task_column(board_id, name, position, wip_limit, color);
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(column_to_json(col).dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Update column
    app.put("/api/spaces/:id/tasks/boards/:boardId/columns/:columnId", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string column_id(req->getParameter("columnId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id),
                     column_id = std::move(column_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            auto col = db.find_task_column(column_id);
            if (!col || col->board_id != board_id) {
                res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(R"({"error":"Column not found"})");
                return;
            }

            try {
                auto j = json::parse(body);
                std::string name = j.value("name", col->name);
                int wip_limit = j.value("wip_limit", col->wip_limit);
                std::string color = j.value("color", col->color);

                auto updated = db.update_task_column(column_id, name, wip_limit, color);
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(column_to_json(updated).dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Reorder columns
    app.put("/api/spaces/:id/tasks/boards/:boardId/columns/reorder", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                auto column_ids = j.at("column_ids").get<std::vector<std::string>>();
                db.reorder_task_columns(board_id, column_ids);
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(R"({"ok":true})");
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Delete column
    app.del("/api/spaces/:id/tasks/boards/:boardId/columns/:columnId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string column_id(req->getParameter("columnId"));
        if (!check_space_access(res, space_id, user_id)) return;
        if (!require_permission(res, space_id, user_id, "edit")) return;

        auto col = db.find_task_column(column_id);
        if (!col || col->board_id != board_id) {
            res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                ->writeHeader("Access-Control-Allow-Origin", "*")
                ->end(R"({"error":"Column not found"})");
            return;
        }

        // Check if column has tasks
        int count = db.get_column_task_count(column_id);
        if (count > 0) {
            res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                ->writeHeader("Access-Control-Allow-Origin", "*")
                ->end(R"({"error":"Column still has tasks. Move or delete them first."})");
            return;
        }

        db.delete_task_column(column_id);
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"ok":true})");
    });

    // --- Tasks ---

    // Create task
    app.post("/api/spaces/:id/tasks/boards/:boardId/tasks", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            auto board = db.find_task_board(board_id);
            if (!board || board->space_id != space_id) {
                res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(R"({"error":"Board not found"})");
                return;
            }

            try {
                auto j = json::parse(body);
                std::string column_id = j.at("column_id");
                std::string title = j.at("title");
                std::string description = j.value("description", "");
                std::string priority = j.value("priority", "medium");
                std::string due_date = j.value("due_date", "");
                std::string color = j.value("color", "");
                int position = j.value("position", 0);
                std::string start_date = j.value("start_date", "");
                int duration_days = j.value("duration_days", 0);

                if (title.empty() || title.length() > 255) {
                    res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                        ->writeHeader("Access-Control-Allow-Origin", "*")
                        ->end(R"json({"error":"Title is required (max 255 characters)"})json");
                    return;
                }

                auto task = db.create_task(board_id, column_id, title, description,
                                            priority, due_date, color, position, user_id,
                                            start_date, duration_days);
                auto creator = db.find_user_by_id(user_id);
                task.created_by_username = creator ? creator->username : "";

                // Add assignees if provided
                if (j.contains("assignee_ids")) {
                    for (const auto& aid : j["assignee_ids"]) {
                        db.add_task_assignee(task.id, aid.get<std::string>());
                    }
                }

                // Add labels if provided
                if (j.contains("label_ids")) {
                    for (const auto& lid : j["label_ids"]) {
                        db.assign_task_label(task.id, lid.get<std::string>());
                    }
                }

                // Log activity
                db.log_task_activity(task.id, user_id, "created",
                    json({{"title", title}}).dump());

                json resp = task_to_json(task);
                auto assignees = db.get_task_assignees(task.id);
                json a_arr = json::array();
                for (const auto& a : assignees) a_arr.push_back(assignee_to_json(a));
                resp["assignees"] = a_arr;

                auto labels = db.get_task_labels(task.id);
                json l_arr = json::array();
                for (const auto& l : labels) l_arr.push_back(label_to_json(l));
                resp["labels"] = l_arr;

                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(resp.dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Get single task detail (with checklists, activity)
    app.get("/api/spaces/:id/tasks/boards/:boardId/tasks/:taskId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string task_id(req->getParameter("taskId"));
        if (!check_space_access(res, space_id, user_id)) return;

        auto task = db.find_task(task_id);
        if (!task || task->board_id != board_id) {
            res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                ->writeHeader("Access-Control-Allow-Origin", "*")
                ->end(R"({"error":"Task not found"})");
            return;
        }

        json resp = task_to_json(*task);
        resp["my_permission"] = get_access_level(space_id, user_id);

        // Assignees
        auto assignees = db.get_task_assignees(task_id);
        json a_arr = json::array();
        for (const auto& a : assignees) a_arr.push_back(assignee_to_json(a));
        resp["assignees"] = a_arr;

        // Labels
        auto labels = db.get_task_labels(task_id);
        json l_arr = json::array();
        for (const auto& l : labels) l_arr.push_back(label_to_json(l));
        resp["labels"] = l_arr;

        // Checklists with items
        auto checklists = db.get_task_checklists(task_id);
        json cl_arr = json::array();
        for (const auto& cl : checklists) {
            json cl_obj = checklist_to_json(cl);
            auto items = db.get_checklist_items(cl.id);
            json items_arr = json::array();
            for (const auto& item : items) items_arr.push_back(checklist_item_to_json(item));
            cl_obj["items"] = items_arr;
            cl_arr.push_back(cl_obj);
        }
        resp["checklists"] = cl_arr;

        // Activity
        auto activity = db.get_task_activity(task_id, 50);
        json act_arr = json::array();
        for (const auto& a : activity) act_arr.push_back(activity_to_json(a));
        resp["activity"] = act_arr;

        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(resp.dump());
    });

    // Update task
    app.put("/api/spaces/:id/tasks/boards/:boardId/tasks/:taskId", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string task_id(req->getParameter("taskId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id),
                     task_id = std::move(task_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            auto existing = db.find_task(task_id);
            if (!existing || existing->board_id != board_id) {
                res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(R"({"error":"Task not found"})");
                return;
            }

            try {
                auto j = json::parse(body);
                std::string column_id = j.value("column_id", existing->column_id);
                std::string title = j.value("title", existing->title);
                std::string description = j.value("description", existing->description);
                std::string priority = j.value("priority", existing->priority);
                std::string due_date = j.value("due_date", existing->due_date);
                std::string color = j.value("color", existing->color);
                int position = j.value("position", existing->position);
                std::string start_date = j.value("start_date", existing->start_date);
                int duration_days = j.value("duration_days", existing->duration_days);

                // Log changes
                json changes = json::object();
                if (column_id != existing->column_id) changes["column"] = {{"from", existing->column_id}, {"to", column_id}};
                if (title != existing->title) changes["title"] = {{"from", existing->title}, {"to", title}};
                if (priority != existing->priority) changes["priority"] = {{"from", existing->priority}, {"to", priority}};
                if (due_date != existing->due_date) changes["due_date"] = {{"from", existing->due_date}, {"to", due_date}};

                auto task = db.update_task(task_id, column_id, title, description,
                                            priority, due_date, color, position,
                                            start_date, duration_days);

                // Handle assignees update
                if (j.contains("assignee_ids")) {
                    auto current = db.get_task_assignees(task_id);
                    auto new_ids = j["assignee_ids"].get<std::vector<std::string>>();
                    // Remove old
                    for (const auto& a : current) {
                        if (std::find(new_ids.begin(), new_ids.end(), a.user_id) == new_ids.end()) {
                            db.remove_task_assignee(task_id, a.user_id);
                        }
                    }
                    // Add new
                    for (const auto& id : new_ids) {
                        db.add_task_assignee(task_id, id);
                    }
                }

                // Handle labels update
                if (j.contains("label_ids")) {
                    auto current = db.get_task_labels(task_id);
                    auto new_ids = j["label_ids"].get<std::vector<std::string>>();
                    for (const auto& l : current) {
                        if (std::find(new_ids.begin(), new_ids.end(), l.id) == new_ids.end()) {
                            db.unassign_task_label(task_id, l.id);
                        }
                    }
                    for (const auto& id : new_ids) {
                        db.assign_task_label(task_id, id);
                    }
                }

                if (!changes.empty()) {
                    std::string action = changes.contains("column") ? "moved" : "updated";
                    db.log_task_activity(task_id, user_id, action, changes.dump());
                }

                auto creator = db.find_user_by_id(task.created_by);
                task.created_by_username = creator ? creator->username : "";

                json resp = task_to_json(task);
                auto assignees = db.get_task_assignees(task_id);
                json a_arr = json::array();
                for (const auto& a : assignees) a_arr.push_back(assignee_to_json(a));
                resp["assignees"] = a_arr;

                auto labels = db.get_task_labels(task_id);
                json l_arr = json::array();
                for (const auto& l : labels) l_arr.push_back(label_to_json(l));
                resp["labels"] = l_arr;

                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(resp.dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Delete task
    app.del("/api/spaces/:id/tasks/boards/:boardId/tasks/:taskId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string task_id(req->getParameter("taskId"));
        if (!check_space_access(res, space_id, user_id)) return;

        auto task = db.find_task(task_id);
        if (!task || task->board_id != board_id) {
            res->writeStatus("404")->writeHeader("Content-Type", "application/json")
                ->writeHeader("Access-Control-Allow-Origin", "*")
                ->end(R"({"error":"Task not found"})");
            return;
        }

        if (task->created_by != user_id) {
            if (!require_permission(res, space_id, user_id, "owner")) return;
        }

        db.delete_task(task_id);
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"ok":true})");
    });

    // Reorder / move tasks
    app.put("/api/spaces/:id/tasks/boards/:boardId/tasks/reorder", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                // Expects: { tasks: [{ id, column_id, position }] }
                auto items = j.at("tasks");
                std::vector<std::pair<std::string, int>> positions;
                for (const auto& item : items) {
                    std::string tid = item.at("id");
                    int pos = item.at("position");
                    positions.push_back({tid, pos});

                    // Update column_id if changed
                    if (item.contains("column_id")) {
                        auto task = db.find_task(tid);
                        if (task && task->column_id != item["column_id"].get<std::string>()) {
                            std::string new_col = item["column_id"].get<std::string>();
                            db.update_task(tid, new_col, task->title, task->description,
                                          task->priority, task->due_date, task->color, pos,
                                          task->start_date, task->duration_days);
                            db.log_task_activity(tid, user_id, "moved",
                                json({{"column", {{"from", task->column_id}, {"to", new_col}}}}).dump());
                        }
                    }
                }
                db.reorder_tasks(positions);

                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(R"({"ok":true})");
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // --- Checklists ---

    // Create checklist
    app.post("/api/spaces/:id/tasks/boards/:boardId/tasks/:taskId/checklists", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string task_id(req->getParameter("taskId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id),
                     task_id = std::move(task_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                std::string title = j.at("title");
                int position = j.value("position", 0);

                auto cl = db.create_task_checklist(task_id, title, position);
                db.log_task_activity(task_id, user_id, "checklist_added",
                    json({{"title", title}}).dump());

                json resp = checklist_to_json(cl);
                resp["items"] = json::array();
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(resp.dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Delete checklist
    app.del("/api/spaces/:id/tasks/boards/:boardId/tasks/:taskId/checklists/:checklistId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        if (!check_space_access(res, space_id, user_id)) return;
        if (!require_permission(res, space_id, user_id, "edit")) return;

        std::string checklist_id(req->getParameter("checklistId"));
        db.delete_task_checklist(checklist_id);
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"ok":true})");
    });

    // Create checklist item
    app.post("/api/spaces/:id/tasks/boards/:boardId/tasks/:taskId/checklists/:checklistId/items", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string checklist_id(req->getParameter("checklistId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     checklist_id = std::move(checklist_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                std::string content = j.at("content");
                int position = j.value("position", 0);

                auto item = db.create_checklist_item(checklist_id, content, position);
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(checklist_item_to_json(item).dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Update checklist item
    app.put("/api/spaces/:id/tasks/boards/:boardId/tasks/:taskId/checklists/:checklistId/items/:itemId", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string item_id(req->getParameter("itemId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     item_id = std::move(item_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                std::string content = j.value("content", "");
                bool is_checked = j.value("is_checked", false);

                auto item = db.update_checklist_item(item_id, content, is_checked);
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(checklist_item_to_json(item).dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Delete checklist item
    app.del("/api/spaces/:id/tasks/boards/:boardId/tasks/:taskId/checklists/:checklistId/items/:itemId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        if (!check_space_access(res, space_id, user_id)) return;
        if (!require_permission(res, space_id, user_id, "edit")) return;

        std::string item_id(req->getParameter("itemId"));
        db.delete_checklist_item(item_id);
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"ok":true})");
    });

    // --- Labels ---

    // Create label
    app.post("/api/spaces/:id/tasks/boards/:boardId/labels", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                std::string name = j.at("name");
                std::string color = j.value("color", "");

                auto label = db.create_task_label(board_id, name, color);
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(label_to_json(label).dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Update label
    app.put("/api/spaces/:id/tasks/boards/:boardId/labels/:labelId", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string label_id(req->getParameter("labelId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     label_id = std::move(label_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                std::string name = j.at("name");
                std::string color = j.value("color", "");

                auto label = db.update_task_label(label_id, name, color);
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(label_to_json(label).dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Delete label
    app.del("/api/spaces/:id/tasks/boards/:boardId/labels/:labelId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        if (!check_space_access(res, space_id, user_id)) return;
        if (!require_permission(res, space_id, user_id, "edit")) return;

        std::string label_id(req->getParameter("labelId"));
        db.delete_task_label(label_id);
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"ok":true})");
    });

    // --- Dependencies ---

    // Add dependency
    app.post("/api/spaces/:id/tasks/boards/:boardId/dependencies", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string board_id(req->getParameter("boardId"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id),
                     board_id = std::move(board_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "edit")) return;

            try {
                auto j = json::parse(body);
                std::string task_id = j.at("task_id");
                std::string depends_on_id = j.at("depends_on_id");
                std::string dep_type = j.value("dependency_type", "finish_to_start");

                auto dep = db.add_task_dependency(task_id, depends_on_id, dep_type);
                db.log_task_activity(task_id, user_id, "dependency_added",
                    json({{"depends_on_id", depends_on_id}, {"type", dep_type}}).dump());

                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(dependency_to_json(dep).dump());
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Remove dependency
    app.del("/api/spaces/:id/tasks/boards/:boardId/dependencies/:depId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        if (!check_space_access(res, space_id, user_id)) return;
        if (!require_permission(res, space_id, user_id, "edit")) return;

        std::string dep_id(req->getParameter("depId"));
        db.remove_task_dependency(dep_id);
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"ok":true})");
    });

    // --- Permissions ---

    // List permissions
    app.get("/api/spaces/:id/tasks/permissions", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        if (!check_space_access(res, space_id, user_id)) return;

        auto perms = db.get_task_permissions(space_id);
        json arr = json::array();
        for (const auto& p : perms) arr.push_back(permission_to_json(p));

        json resp = {{"permissions", arr}, {"my_permission", get_access_level(space_id, user_id)}};
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(resp.dump());
    });

    // Set permission
    app.post("/api/spaces/:id/tasks/permissions", [this](auto* res, auto* req) {
        auto user_id_copy = get_user_id(res, req);
        std::string space_id(req->getParameter("id"));
        std::string body;
        res->onData([this, res, user_id = std::move(user_id_copy),
                     space_id = std::move(space_id), body = std::move(body)](
            std::string_view data, bool last) mutable {
            body.append(data);
            if (!last) return;
            if (user_id.empty()) return;
            if (!check_space_access(res, space_id, user_id)) return;
            if (!require_permission(res, space_id, user_id, "owner")) return;

            try {
                auto j = json::parse(body);
                std::string target_user_id = j.at("user_id");
                std::string permission = j.at("permission");

                if (permission != "owner" && permission != "edit" && permission != "view") {
                    res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                        ->writeHeader("Access-Control-Allow-Origin", "*")
                        ->end(R"({"error":"Permission must be owner, edit, or view"})");
                    return;
                }

                db.set_task_permission(space_id, target_user_id, permission, user_id);
                res->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(R"({"ok":true})");
            } catch (const std::exception& e) {
                res->writeStatus("400")->writeHeader("Content-Type", "application/json")
                    ->writeHeader("Access-Control-Allow-Origin", "*")
                    ->end(json({{"error", e.what()}}).dump());
            }
        });
        res->onAborted([]() {});
    });

    // Remove permission
    app.del("/api/spaces/:id/tasks/permissions/:userId", [this](auto* res, auto* req) {
        std::string user_id = get_user_id(res, req);
        if (user_id.empty()) return;
        std::string space_id(req->getParameter("id"));
        std::string target_user_id(req->getParameter("userId"));
        if (!check_space_access(res, space_id, user_id)) return;
        if (!require_permission(res, space_id, user_id, "owner")) return;

        db.remove_task_permission(space_id, target_user_id);
        res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"ok":true})");
    });
}

// --- Permission helpers ---

template <bool SSL>
std::string TaskBoardHandler<SSL>::get_user_id(uWS::HttpResponse<SSL>* res, uWS::HttpRequest* req) {
    return validate_session_or_401(res, req, db);
}

template <bool SSL>
bool TaskBoardHandler<SSL>::check_space_access(uWS::HttpResponse<SSL>* res,
                                                 const std::string& space_id,
                                                 const std::string& user_id) {
    if (db.is_space_member(space_id, user_id)) return true;
    auto user = db.find_user_by_id(user_id);
    if (user && (user->role == "admin" || user->role == "owner")) return true;

    res->writeStatus("403")->writeHeader("Content-Type", "application/json")
        ->writeHeader("Access-Control-Allow-Origin", "*")
        ->end(R"({"error":"Not a member of this space"})");
    return false;
}

template <bool SSL>
std::string TaskBoardHandler<SSL>::get_access_level(const std::string& space_id,
                                                       const std::string& user_id) {
    auto user = db.find_user_by_id(user_id);
    if (user && (user->role == "admin" || user->role == "owner")) return "owner";

    auto space_role = db.get_space_member_role(space_id, user_id);
    if (space_role == "admin" || space_role == "owner") return "owner";

    // "user" role members default to "view"; task-level permissions can escalate
    auto task_perm = db.get_task_permission(space_id, user_id);
    if (!task_perm.empty()) {
        return task_perm;
    }

    return "view";
}

template <bool SSL>
bool TaskBoardHandler<SSL>::require_permission(uWS::HttpResponse<SSL>* res,
                                                 const std::string& space_id,
                                                 const std::string& user_id,
                                                 const std::string& required_level) {
    auto level = get_access_level(space_id, user_id);
    if (perm_rank(level) >= perm_rank(required_level)) return true;

    res->writeStatus("403")->writeHeader("Content-Type", "application/json")
        ->writeHeader("Access-Control-Allow-Origin", "*")
        ->end(json({{"error", "Requires " + required_level + " permission"}}).dump());
    return false;
}

template <bool SSL>
int TaskBoardHandler<SSL>::perm_rank(const std::string& p) {
    if (p == "owner") return 2;
    if (p == "edit") return 1;
    return 0;
}

template struct TaskBoardHandler<false>;
template struct TaskBoardHandler<true>;
