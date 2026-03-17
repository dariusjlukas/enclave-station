#include "handlers/wiki_handler.h"
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <pqxx/pqxx>
#include "handlers/file_access_utils.h"
#include "handlers/format_utils.h"

using json = nlohmann::json;

static json page_to_json(const WikiPage& p) {
  return {
    {"id", p.id},
    {"space_id", p.space_id},
    {"parent_id", p.parent_id.empty() ? json(nullptr) : json(p.parent_id)},
    {"title", p.title},
    {"slug", p.slug},
    {"is_folder", p.is_folder},
    {"content", p.content},
    {"content_text", p.content_text},
    {"icon", p.icon},
    {"cover_image_file_id", p.cover_image_file_id},
    {"position", p.position},
    {"is_deleted", p.is_deleted},
    {"created_by", p.created_by},
    {"created_by_username", p.created_by_username},
    {"created_at", p.created_at},
    {"updated_at", p.updated_at},
    {"last_edited_by", p.last_edited_by},
    {"last_edited_by_username", p.last_edited_by_username}};
}

static json version_to_json(const WikiPageVersion& v) {
  return {
    {"id", v.id},
    {"page_id", v.page_id},
    {"version_number", v.version_number},
    {"title", v.title},
    {"content", v.content},
    {"content_text", v.content_text},
    {"is_major", v.is_major},
    {"edited_by", v.edited_by},
    {"edited_by_username", v.edited_by_username},
    {"created_at", v.created_at}};
}

static json page_permission_to_json(const WikiPagePermission& p) {
  return {
    {"id", p.id},
    {"page_id", p.page_id},
    {"user_id", p.user_id},
    {"username", p.username},
    {"display_name", p.display_name},
    {"permission", p.permission},
    {"granted_by", p.granted_by},
    {"granted_by_username", p.granted_by_username},
    {"created_at", p.created_at}};
}

static json wiki_permission_to_json(const WikiPermission& p) {
  return {
    {"id", p.id},
    {"space_id", p.space_id},
    {"user_id", p.user_id},
    {"username", p.username},
    {"display_name", p.display_name},
    {"permission", p.permission},
    {"granted_by", p.granted_by},
    {"granted_by_username", p.granted_by_username},
    {"created_at", p.created_at}};
}

static std::string generate_slug(const std::string& title) {
  std::string slug;
  slug.reserve(title.size());
  for (char c : title) {
    if (std::isalnum(static_cast<unsigned char>(c))) {
      slug += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    } else {
      slug += '-';
    }
  }
  // Collapse multiple hyphens
  std::string result;
  result.reserve(slug.size());
  bool prev_hyphen = false;
  for (char c : slug) {
    if (c == '-') {
      if (!prev_hyphen) result += c;
      prev_hyphen = true;
    } else {
      result += c;
      prev_hyphen = false;
    }
  }
  // Trim leading/trailing hyphens
  size_t start = result.find_first_not_of('-');
  if (start == std::string::npos) return "page";
  size_t end = result.find_last_not_of('-');
  return result.substr(start, end - start + 1);
}

template <bool SSL>
void WikiHandler<SSL>::register_routes(uWS::TemplatedApp<SSL>& app) {
  // --- Pages ---

  // List pages in folder
  app.get("/api/spaces/:id/wiki/pages", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter("id"));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_permission(res, space_id, user_id, "view")) return;

    std::string parent_id(req->getQuery("parent_id"));
    auto pages = db.list_wiki_pages(space_id, parent_id);

    json arr = json::array();
    for (const auto& p : pages) arr.push_back(page_to_json(p));

    json resp = {{"pages", arr}, {"my_permission", get_access_level(space_id, user_id)}};
    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(resp.dump());
  });

  // Full page tree for sidebar
  app.get("/api/spaces/:id/wiki/tree", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter("id"));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_permission(res, space_id, user_id, "view")) return;

    auto pages = db.get_wiki_tree(space_id);

    json arr = json::array();
    for (const auto& p : pages) arr.push_back(page_to_json(p));

    json resp = {{"pages", arr}, {"my_permission", get_access_level(space_id, user_id)}};
    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(resp.dump());
  });

  // Create page or folder
  app.post("/api/spaces/:id/wiki/pages", [this](auto* res, auto* req) {
    auto user_id_copy = get_user_id(res, req);
    std::string space_id(req->getParameter("id"));
    std::string body;
    res->onData([this,
                 res,
                 user_id = std::move(user_id_copy),
                 space_id = std::move(space_id),
                 body = std::move(body)](std::string_view data, bool last) mutable {
      body.append(data);
      if (!last) return;
      if (user_id.empty()) return;
      if (!check_space_access(res, space_id, user_id)) return;
      if (!require_permission(res, space_id, user_id, "edit")) return;

      try {
        auto j = json::parse(body);
        std::string title = j.at("title");
        std::string parent_id = j.value("parent_id", "");
        bool is_folder = j.value("is_folder", false);
        std::string content = j.value("content", "");
        std::string content_text = content;
        std::string icon = j.value("icon", "");
        int position = j.value("position", 0);

        if (title.empty() || title.length() > 255) {
          res->writeStatus("400")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"json({"error":"Title is required (max 255 characters)"})json");
          return;
        }

        // Generate slug from title
        std::string slug = generate_slug(title);
        if (slug.empty()) slug = "page";

        // Ensure unique slug within parent
        if (db.wiki_page_slug_exists(space_id, parent_id, slug)) {
          int suffix = 2;
          while (
            db.wiki_page_slug_exists(space_id, parent_id, slug + "-" + std::to_string(suffix))) {
            suffix++;
          }
          slug = slug + "-" + std::to_string(suffix);
        }

        auto page = db.create_wiki_page(
          space_id,
          parent_id,
          title,
          slug,
          is_folder,
          content,
          content_text,
          icon,
          position,
          user_id);
        // Create initial version for history (major)
        db.create_wiki_page_version(page.id, title, content, content_text, user_id, true);

        auto creator = db.find_user_by_id(user_id);
        page.created_by_username = creator ? creator->username : "";

        res->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(page_to_json(page).dump());
      } catch (const std::exception& e) {
        std::cerr << "[Wiki] Create page error: " << e.what() << std::endl;
        res->writeStatus("400")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(json({{"error", e.what()}}).dump());
      }
    });
    res->onAborted([]() {});
  });

  // Get page with content + path
  app.get("/api/spaces/:id/wiki/pages/:pageId", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_page_permission(res, space_id, page_id, user_id, "view")) return;

    auto page = db.find_wiki_page(page_id);
    if (!page || page->space_id != space_id || page->is_deleted) {
      res->writeStatus("404")
        ->writeHeader("Content-Type", "application/json")
        ->writeHeader("Access-Control-Allow-Origin", "*")
        ->end(R"({"error":"Page not found"})");
      return;
    }

    json resp = page_to_json(*page);
    resp["my_permission"] = get_page_access_level(space_id, page_id, user_id);

    // Include breadcrumb path
    auto path = db.get_wiki_page_path(page_id);
    json path_arr = json::array();
    for (const auto& p : path) {
      path_arr.push_back({{"id", p.id}, {"title", p.title}, {"slug", p.slug}});
    }
    resp["path"] = path_arr;

    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(resp.dump());
  });

  // Update page
  app.put("/api/spaces/:id/wiki/pages/:pageId", [this](auto* res, auto* req) {
    auto user_id_copy = get_user_id(res, req);
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    std::string body;
    res->onData([this,
                 res,
                 user_id = std::move(user_id_copy),
                 space_id = std::move(space_id),
                 page_id = std::move(page_id),
                 body = std::move(body)](std::string_view data, bool last) mutable {
      body.append(data);
      if (!last) return;
      if (user_id.empty()) return;
      if (!check_space_access(res, space_id, user_id)) return;
      if (!require_page_permission(res, space_id, page_id, user_id, "edit")) return;

      auto existing = db.find_wiki_page(page_id);
      if (!existing || existing->space_id != space_id || existing->is_deleted) {
        res->writeStatus("404")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"error":"Page not found"})");
        return;
      }

      try {
        auto j = json::parse(body);
        std::string title = j.value("title", existing->title);
        std::string content = j.value("content", existing->content);
        std::string content_text = content;
        std::string icon = j.value("icon", existing->icon);
        std::string cover_image_file_id =
          j.value("cover_image_file_id", existing->cover_image_file_id);
        bool create_version = j.value("create_version", false);

        // Generate slug from title if title changed
        std::string slug = existing->slug;
        if (title != existing->title) {
          slug = generate_slug(title);
          if (slug.empty()) slug = "page";
          if (db.wiki_page_slug_exists(space_id, existing->parent_id, slug, page_id)) {
            int suffix = 2;
            while (db.wiki_page_slug_exists(
              space_id, existing->parent_id, slug + "-" + std::to_string(suffix), page_id)) {
              suffix++;
            }
            slug = slug + "-" + std::to_string(suffix);
          }
        }

        // Create a major version snapshot when explicitly requested (e.g. leaving edit mode)
        // but only if content or title actually changed since the last version
        if (create_version) {
          auto prev_versions = db.list_wiki_page_versions(page_id);
          bool changed = prev_versions.empty() || prev_versions[0].title != existing->title ||
                         prev_versions[0].content != existing->content;
          if (changed) {
            db.create_wiki_page_version(
              page_id, existing->title, existing->content, existing->content_text, user_id, true);
          }
        }

        // Update page
        auto page = db.update_wiki_page(
          page_id, title, slug, content, content_text, icon, cover_image_file_id, user_id);

        auto creator = db.find_user_by_id(page.created_by);
        page.created_by_username = creator ? creator->username : "";
        auto editor = db.find_user_by_id(user_id);
        page.last_edited_by_username = editor ? editor->username : "";

        res->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(page_to_json(page).dump());
      } catch (const std::exception& e) {
        res->writeStatus("400")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(json({{"error", e.what()}}).dump());
      }
    });
    res->onAborted([]() {});
  });

  // Delete page (soft-delete)
  app.del("/api/spaces/:id/wiki/pages/:pageId", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    if (!check_space_access(res, space_id, user_id)) return;

    auto page = db.find_wiki_page(page_id);
    if (!page || page->space_id != space_id || page->is_deleted) {
      res->writeStatus("404")
        ->writeHeader("Content-Type", "application/json")
        ->writeHeader("Access-Control-Allow-Origin", "*")
        ->end(R"({"error":"Page not found"})");
      return;
    }

    // Owner of the page can delete with edit permission, otherwise need owner
    if (page->created_by == user_id) {
      if (!require_page_permission(res, space_id, page_id, user_id, "edit")) return;
    } else {
      if (!require_page_permission(res, space_id, page_id, user_id, "owner")) return;
    }

    db.soft_delete_wiki_page(page_id);
    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(R"({"ok":true})");
  });

  // Move page to new parent
  app.put("/api/spaces/:id/wiki/pages/:pageId/move", [this](auto* res, auto* req) {
    auto user_id_copy = get_user_id(res, req);
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    std::string body;
    res->onData([this,
                 res,
                 user_id = std::move(user_id_copy),
                 space_id = std::move(space_id),
                 page_id = std::move(page_id),
                 body = std::move(body)](std::string_view data, bool last) mutable {
      body.append(data);
      if (!last) return;
      if (user_id.empty()) return;
      if (!check_space_access(res, space_id, user_id)) return;
      if (!require_page_permission(res, space_id, page_id, user_id, "edit")) return;

      auto page = db.find_wiki_page(page_id);
      if (!page || page->space_id != space_id || page->is_deleted) {
        res->writeStatus("404")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"error":"Page not found"})");
        return;
      }

      try {
        auto j = json::parse(body);
        std::string new_parent_id = j.value("parent_id", "");

        db.move_wiki_page(page_id, new_parent_id);

        auto updated = db.find_wiki_page(page_id);
        res->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(page_to_json(updated ? *updated : *page).dump());
      } catch (const std::exception& e) {
        res->writeStatus("400")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(json({{"error", e.what()}}).dump());
      }
    });
    res->onAborted([]() {});
  });

  // Reorder pages within folder
  app.post("/api/spaces/:id/wiki/pages/reorder", [this](auto* res, auto* req) {
    auto user_id_copy = get_user_id(res, req);
    std::string space_id(req->getParameter("id"));
    std::string body;
    res->onData([this,
                 res,
                 user_id = std::move(user_id_copy),
                 space_id = std::move(space_id),
                 body = std::move(body)](std::string_view data, bool last) mutable {
      body.append(data);
      if (!last) return;
      if (user_id.empty()) return;
      if (!check_space_access(res, space_id, user_id)) return;
      if (!require_permission(res, space_id, user_id, "edit")) return;

      try {
        auto j = json::parse(body);
        auto positions = j.at("positions").get<std::vector<json>>();
        std::vector<std::pair<std::string, int>> page_positions;
        for (const auto& pos : positions) {
          page_positions.emplace_back(
            pos.at("id").get<std::string>(), pos.at("position").get<int>());
        }
        db.reorder_wiki_pages(page_positions);
        res->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"ok":true})");
      } catch (const std::exception& e) {
        res->writeStatus("400")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(json({{"error", e.what()}}).dump());
      }
    });
    res->onAborted([]() {});
  });

  // --- Versions ---

  // List version history
  app.get("/api/spaces/:id/wiki/pages/:pageId/versions", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_page_permission(res, space_id, page_id, user_id, "view")) return;

    auto page = db.find_wiki_page(page_id);
    if (!page || page->space_id != space_id || page->is_deleted) {
      res->writeStatus("404")
        ->writeHeader("Content-Type", "application/json")
        ->writeHeader("Access-Control-Allow-Origin", "*")
        ->end(R"({"error":"Page not found"})");
      return;
    }

    auto versions = db.list_wiki_page_versions(page_id);
    json arr = json::array();
    for (const auto& v : versions) arr.push_back(version_to_json(v));

    json resp = {{"versions", arr}};
    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(resp.dump());
  });

  // Get specific version
  app.get("/api/spaces/:id/wiki/pages/:pageId/versions/:versionId", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    std::string version_id(req->getParameter(2));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_page_permission(res, space_id, page_id, user_id, "view")) return;

    auto page = db.find_wiki_page(page_id);
    if (!page || page->space_id != space_id || page->is_deleted) {
      res->writeStatus("404")
        ->writeHeader("Content-Type", "application/json")
        ->writeHeader("Access-Control-Allow-Origin", "*")
        ->end(R"({"error":"Page not found"})");
      return;
    }

    auto version = db.get_wiki_page_version(version_id);
    if (!version || version->page_id != page_id) {
      res->writeStatus("404")
        ->writeHeader("Content-Type", "application/json")
        ->writeHeader("Access-Control-Allow-Origin", "*")
        ->end(R"({"error":"Version not found"})");
      return;
    }

    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(version_to_json(*version).dump());
  });

  // Revert to version
  app.post(
    "/api/spaces/:id/wiki/pages/:pageId/versions/:versionId/revert", [this](auto* res, auto* req) {
      auto user_id_copy = get_user_id(res, req);
      std::string space_id(req->getParameter(0));
      std::string page_id(req->getParameter(1));
      std::string version_id(req->getParameter(2));
      std::string body;
      res->onData([this,
                   res,
                   user_id = std::move(user_id_copy),
                   space_id = std::move(space_id),
                   page_id = std::move(page_id),
                   version_id = std::move(version_id),
                   body = std::move(body)](std::string_view data, bool last) mutable {
        body.append(data);
        if (!last) return;
        if (user_id.empty()) return;
        if (!check_space_access(res, space_id, user_id)) return;
        if (!require_page_permission(res, space_id, page_id, user_id, "edit")) return;

        auto page = db.find_wiki_page(page_id);
        if (!page || page->space_id != space_id || page->is_deleted) {
          res->writeStatus("404")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Page not found"})");
          return;
        }

        auto version = db.get_wiki_page_version(version_id);
        if (!version || version->page_id != page_id) {
          res->writeStatus("404")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Version not found"})");
          return;
        }

        try {
          // Create a new version with the current content
          db.create_wiki_page_version(
            page_id, page->title, page->content, page->content_text, user_id);

          // Update page with the version's content
          auto updated = db.update_wiki_page(
            page_id,
            version->title,
            page->slug,
            version->content,
            version->content_text,
            page->icon,
            page->cover_image_file_id,
            user_id);

          auto creator = db.find_user_by_id(updated.created_by);
          updated.created_by_username = creator ? creator->username : "";
          auto editor = db.find_user_by_id(user_id);
          updated.last_edited_by_username = editor ? editor->username : "";

          res->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(page_to_json(updated).dump());
        } catch (const std::exception& e) {
          res->writeStatus("400")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(json({{"error", e.what()}}).dump());
        }
      });
      res->onAborted([]() {});
    });

  // --- Page Permissions ---

  // List page permissions
  app.get("/api/spaces/:id/wiki/pages/:pageId/permissions", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_page_permission(res, space_id, page_id, user_id, "view")) return;

    auto perms = db.get_wiki_page_permissions(page_id);
    json arr = json::array();
    for (const auto& p : perms) arr.push_back(page_permission_to_json(p));

    json resp = {
      {"permissions", arr}, {"my_permission", get_page_access_level(space_id, page_id, user_id)}};
    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(resp.dump());
  });

  // Set page permission
  app.post("/api/spaces/:id/wiki/pages/:pageId/permissions", [this](auto* res, auto* req) {
    auto user_id_copy = get_user_id(res, req);
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    std::string body;
    res->onData([this,
                 res,
                 user_id = std::move(user_id_copy),
                 space_id = std::move(space_id),
                 page_id = std::move(page_id),
                 body = std::move(body)](std::string_view data, bool last) mutable {
      body.append(data);
      if (!last) return;
      if (user_id.empty()) return;
      if (!check_space_access(res, space_id, user_id)) return;
      if (!require_page_permission(res, space_id, page_id, user_id, "owner")) return;

      try {
        auto j = json::parse(body);
        std::string target_user_id = j.at("user_id");
        std::string permission = j.at("permission");

        if (permission != "owner" && permission != "edit" && permission != "view") {
          res->writeStatus("400")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Invalid permission level"})");
          return;
        }

        // Personal spaces: only view and edit allowed, not owner
        {
          auto space_perm_check = db.find_space_by_id(space_id);
          if (space_perm_check && space_perm_check->is_personal && permission == "owner") {
            res->writeStatus("400")
              ->writeHeader("Content-Type", "application/json")
              ->writeHeader("Access-Control-Allow-Origin", "*")
              ->end(R"({"error":"Cannot assign owner permission in a personal space"})");
            return;
          }
        }

        db.set_wiki_page_permission(page_id, target_user_id, permission, user_id);
        res->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"ok":true})");
      } catch (const std::exception& e) {
        res->writeStatus("400")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(json({{"error", e.what()}}).dump());
      }
    });
    res->onAborted([]() {});
  });

  // Remove page permission
  app.del("/api/spaces/:id/wiki/pages/:pageId/permissions/:userId", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter(0));
    std::string page_id(req->getParameter(1));
    std::string target_user_id(req->getParameter(2));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_page_permission(res, space_id, page_id, user_id, "owner")) return;

    db.remove_wiki_page_permission(page_id, target_user_id);
    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(R"({"ok":true})");
  });

  // --- Space-level Wiki Permissions ---

  // List space-level wiki permissions
  app.get("/api/spaces/:id/wiki/permissions", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter("id"));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_permission(res, space_id, user_id, "view")) return;

    auto perms = db.get_wiki_permissions(space_id);
    json arr = json::array();
    for (const auto& p : perms) arr.push_back(wiki_permission_to_json(p));

    json resp = {{"permissions", arr}, {"my_permission", get_access_level(space_id, user_id)}};
    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(resp.dump());
  });

  // Set space-level wiki permission
  app.post("/api/spaces/:id/wiki/permissions", [this](auto* res, auto* req) {
    auto user_id_copy = get_user_id(res, req);
    std::string space_id(req->getParameter("id"));
    std::string body;
    res->onData([this,
                 res,
                 user_id = std::move(user_id_copy),
                 space_id = std::move(space_id),
                 body = std::move(body)](std::string_view data, bool last) mutable {
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
          res->writeStatus("400")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Invalid permission level"})");
          return;
        }

        // Personal spaces: only view and edit allowed, not owner
        {
          auto space_perm_check = db.find_space_by_id(space_id);
          if (space_perm_check && space_perm_check->is_personal && permission == "owner") {
            res->writeStatus("400")
              ->writeHeader("Content-Type", "application/json")
              ->writeHeader("Access-Control-Allow-Origin", "*")
              ->end(R"({"error":"Cannot assign owner permission in a personal space"})");
            return;
          }
        }

        db.set_wiki_permission(space_id, target_user_id, permission, user_id);
        res->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"ok":true})");
      } catch (const std::exception& e) {
        res->writeStatus("400")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(json({{"error", e.what()}}).dump());
      }
    });
    res->onAborted([]() {});
  });

  // Remove space-level wiki permission
  app.del("/api/spaces/:id/wiki/permissions/:userId", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter(0));
    std::string target_user_id(req->getParameter(1));
    if (!check_space_access(res, space_id, user_id)) return;
    if (!require_permission(res, space_id, user_id, "owner")) return;

    db.remove_wiki_permission(space_id, target_user_id);
    res->writeHeader("Content-Type", "application/json")
      ->writeHeader("Access-Control-Allow-Origin", "*")
      ->end(R"({"ok":true})");
  });

  // --- Chunked upload: init ---
  app.post("/api/spaces/:id/wiki/upload/init", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter("id"));

    auto body = std::make_shared<std::string>();
    res->onData([this, res, body, space_id, user_id](std::string_view data, bool last) {
      body->append(data);
      if (!last) return;

      try {
        auto j = json::parse(*body);
        std::string filename = j.value("filename", "upload");
        std::string content_type = j.value("content_type", "application/octet-stream");
        int64_t total_size = j.value("total_size", int64_t(0));
        int chunk_count = j.value("chunk_count", 0);
        int64_t chunk_size = j.value("chunk_size", int64_t(0));

        if (chunk_count <= 0 || chunk_size <= 0) {
          res->writeStatus("400")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Invalid chunk count or size"})");
          return;
        }

        if (!check_space_access(res, space_id, user_id)) return;
        if (!require_permission(res, space_id, user_id, "edit")) return;

        int64_t max_size = file_access_utils::parse_max_file_size(
          db.get_setting("max_file_size"), config.max_file_size);
        if (file_access_utils::exceeds_file_size_limit(max_size, total_size)) {
          std::string msg = file_access_utils::file_too_large_message(max_size);
          res->writeStatus("413")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(json{{"error", msg}}.dump());
          return;
        }

        int64_t max_storage =
          file_access_utils::parse_max_storage_size(db.get_setting("max_storage_size"));
        if (
          max_storage > 0 && file_access_utils::exceeds_storage_limit(
                               max_storage, db.get_total_file_size(), total_size)) {
          res->writeStatus("413")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Server storage limit reached"})");
          return;
        }

        int64_t space_limit = file_access_utils::parse_space_storage_limit(
          db.get_setting("space_storage_limit_" + space_id));
        if (
          space_limit > 0 && file_access_utils::exceeds_storage_limit(
                               space_limit, db.get_space_storage_used(space_id), total_size)) {
          res->writeStatus("413")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Space storage limit reached"})");
          return;
        }

        json metadata = {
          {"filename", filename}, {"content_type", content_type}, {"space_id", space_id}};
        std::string upload_id =
          uploads.create_session(user_id, total_size, chunk_count, chunk_size, metadata);

        res->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(json{{"upload_id", upload_id}}.dump());
      } catch (...) {
        res->writeStatus("400")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"error":"Invalid request body"})");
      }
    });
    res->onAborted([]() {});
  });

  // --- Chunked upload: receive chunk ---
  app.post("/api/spaces/:id/wiki/upload/:uploadId/chunk", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string upload_id(req->getParameter(1));
    std::string index_str(req->getQuery("index"));
    std::string expected_hash(req->getQuery("hash"));

    int index = -1;
    try {
      index = std::stoi(index_str);
    } catch (...) {}

    auto body = std::make_shared<std::string>();
    res->onData([this, res, body, upload_id, user_id, index, expected_hash](
                  std::string_view data, bool last) {
      body->append(data);
      if (!last) return;

      auto* session = uploads.get_session(upload_id);
      if (!session || session->user_id != user_id) {
        res->writeStatus("404")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"error":"Upload session not found"})");
        return;
      }

      auto err = uploads.store_chunk_err(upload_id, index, *body, expected_hash);
      if (!err.empty()) {
        if (err == "hash_mismatch") {
          res->writeStatus("409")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Chunk integrity check failed"})");
        } else if (err == "invalid_index") {
          res->writeStatus("400")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Invalid chunk index"})");
        } else {
          res->writeStatus("500")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Failed to store chunk"})");
        }
        return;
      }

      res->writeHeader("Content-Type", "application/json")
        ->writeHeader("Access-Control-Allow-Origin", "*")
        ->end(R"({"ok":true})");
    });
    res->onAborted([]() {});
  });

  // --- Chunked upload: complete ---
  app.post("/api/spaces/:id/wiki/upload/:uploadId/complete", [this](auto* res, auto* req) {
    std::string user_id = get_user_id(res, req);
    if (user_id.empty()) return;
    std::string space_id(req->getParameter(0));
    std::string upload_id(req->getParameter(1));

    res->onData([this, res, space_id, upload_id, user_id](std::string_view, bool last) {
      if (!last) return;

      auto* session = uploads.get_session(upload_id);
      if (!session || session->user_id != user_id) {
        res->writeStatus("404")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"error":"Upload session not found"})");
        return;
      }

      if (!uploads.is_complete(upload_id)) {
        res->writeStatus("400")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"error":"Not all chunks have been uploaded"})");
        return;
      }

      if (!check_space_access(res, space_id, user_id)) {
        uploads.remove_session(upload_id);
        return;
      }

      if (!require_permission(res, space_id, user_id, "edit")) {
        uploads.remove_session(upload_id);
        return;
      }

      try {
        std::string filename = session->metadata.value("filename", "upload");
        std::string content_type =
          session->metadata.value("content_type", "application/octet-stream");

        std::string disk_file_id = format_utils::random_hex(32);
        std::string dest_path = config.upload_dir + "/" + disk_file_id;

        int64_t assembled_size = uploads.assemble(upload_id, dest_path);
        if (assembled_size < 0) {
          res->writeStatus("500")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Failed to assemble file"})");
          uploads.remove_session(upload_id);
          return;
        }

        if (assembled_size != session->total_size) {
          std::filesystem::remove(dest_path);
          res->writeStatus("400")
            ->writeHeader("Content-Type", "application/json")
            ->writeHeader("Access-Control-Allow-Origin", "*")
            ->end(R"({"error":"Assembled file size does not match expected size"})");
          uploads.remove_session(upload_id);
          return;
        }

        // Create space_file with unique name (hidden via tool_source)
        std::string unique_name = disk_file_id + "_" + filename;
        auto file = db.create_space_file(
          space_id, "", unique_name, disk_file_id, assembled_size, content_type, user_id);

        // Mark as wiki file
        db.set_space_file_tool_source(file.id, "wiki");

        uploads.remove_session(upload_id);

        json resp = {{"file_id", file.id}, {"url", "/api/files/" + disk_file_id}};
        res->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(resp.dump());
      } catch (const pqxx::unique_violation&) {
        uploads.remove_session(upload_id);
        res->writeStatus("409")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(R"({"error":"A file with this name already exists"})");
      } catch (const std::exception& e) {
        uploads.remove_session(upload_id);
        res->writeStatus("500")
          ->writeHeader("Content-Type", "application/json")
          ->writeHeader("Access-Control-Allow-Origin", "*")
          ->end(json({{"error", e.what()}}).dump());
      }
    });
    res->onAborted([]() {});
  });
}

// --- Permission helpers ---

template <bool SSL>
std::string WikiHandler<SSL>::get_user_id(uWS::HttpResponse<SSL>* res, uWS::HttpRequest* req) {
  return validate_session_or_401(res, req, db);
}

template <bool SSL>
bool WikiHandler<SSL>::check_space_access(
  uWS::HttpResponse<SSL>* res, const std::string& space_id, const std::string& user_id) {
  if (db.is_space_member(space_id, user_id)) return true;
  auto user = db.find_user_by_id(user_id);
  if (user && (user->role == "admin" || user->role == "owner")) return true;

  // Allow access to personal spaces if user has per-resource permissions
  auto space = db.find_space_by_id(space_id);
  if (space && space->is_personal) {
    if (db.has_resource_permission_in_space(space_id, user_id, "wiki")) return true;
  }

  res->writeStatus("403")
    ->writeHeader("Content-Type", "application/json")
    ->writeHeader("Access-Control-Allow-Origin", "*")
    ->end(R"({"error":"Not a member of this space"})");
  return false;
}

template <bool SSL>
std::string WikiHandler<SSL>::get_access_level(
  const std::string& space_id, const std::string& user_id) {
  auto user = db.find_user_by_id(user_id);
  if (user && (user->role == "admin" || user->role == "owner")) return "owner";

  auto space_role = db.get_space_member_role(space_id, user_id);
  if (space_role == "admin" || space_role == "owner") return "owner";

  // "user" role members default to "view"; tool-level permissions can escalate
  auto wiki_perm = db.get_wiki_permission(space_id, user_id);
  if (!wiki_perm.empty()) {
    return wiki_perm;
  }

  return "view";
}

template <bool SSL>
std::string WikiHandler<SSL>::get_page_access_level(
  const std::string& space_id, const std::string& page_id, const std::string& user_id) {
  std::string base = get_access_level(space_id, user_id);

  auto page_perm = db.get_effective_wiki_page_permission(page_id, user_id);
  if (!page_perm.empty() && perm_rank(page_perm) > perm_rank(base)) {
    return page_perm;
  }

  return base;
}

template <bool SSL>
bool WikiHandler<SSL>::require_permission(
  uWS::HttpResponse<SSL>* res,
  const std::string& space_id,
  const std::string& user_id,
  const std::string& required_level) {
  auto level = get_access_level(space_id, user_id);
  if (perm_rank(level) >= perm_rank(required_level)) return true;

  res->writeStatus("403")
    ->writeHeader("Content-Type", "application/json")
    ->writeHeader("Access-Control-Allow-Origin", "*")
    ->end(json({{"error", "Requires " + required_level + " permission"}}).dump());
  return false;
}

template <bool SSL>
bool WikiHandler<SSL>::require_page_permission(
  uWS::HttpResponse<SSL>* res,
  const std::string& space_id,
  const std::string& page_id,
  const std::string& user_id,
  const std::string& required_level) {
  auto level = get_page_access_level(space_id, page_id, user_id);
  if (perm_rank(level) >= perm_rank(required_level)) return true;

  res->writeStatus("403")
    ->writeHeader("Content-Type", "application/json")
    ->writeHeader("Access-Control-Allow-Origin", "*")
    ->end(json({{"error", "Requires " + required_level + " permission"}}).dump());
  return false;
}

template <bool SSL>
int WikiHandler<SSL>::perm_rank(const std::string& p) {
  if (p == "owner") return 2;
  if (p == "edit") return 1;
  return 0;
}

template struct WikiHandler<false>;
template struct WikiHandler<true>;
