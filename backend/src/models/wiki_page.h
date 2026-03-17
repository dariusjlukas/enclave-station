#pragma once
#include <string>
#include <vector>

struct WikiPage {
  std::string id;
  std::string space_id;
  std::string parent_id;
  std::string title;
  std::string slug;
  bool is_folder = false;
  std::string content;       // JSON string (TipTap document)
  std::string content_text;  // Plain text extraction for search
  std::string icon;
  std::string cover_image_file_id;
  int position = 0;
  bool is_deleted = false;
  std::string created_by;
  std::string created_by_username;
  std::string created_at;
  std::string updated_at;
  std::string last_edited_by;
  std::string last_edited_by_username;
};

struct WikiPageVersion {
  std::string id;
  std::string page_id;
  int version_number = 0;
  std::string title;
  std::string content;
  std::string content_text;
  bool is_major = false;
  std::string edited_by;
  std::string edited_by_username;
  std::string created_at;
};

struct WikiPagePermission {
  std::string id;
  std::string page_id;
  std::string user_id;
  std::string username;
  std::string display_name;
  std::string permission;  // "owner", "edit", "view"
  std::string granted_by;
  std::string granted_by_username;
  std::string created_at;
};

struct WikiPermission {
  std::string id;
  std::string space_id;
  std::string user_id;
  std::string username;
  std::string display_name;
  std::string permission;  // "owner", "edit", "view"
  std::string granted_by;
  std::string granted_by_username;
  std::string created_at;
};
