#pragma once
#include <string>
#include <vector>

struct Space {
  std::string id;
  std::string name;
  std::string description;
  bool is_public = true;
  std::string default_role = "user";
  std::string created_by;
  std::string created_at;
  bool is_archived = false;
  std::string avatar_file_id;
  std::string profile_color;
  bool is_personal = false;
  std::string personal_owner_id;
};

struct SpaceMember {
  std::string user_id;
  std::string username;
  std::string display_name;
  std::string role;
  bool is_online = false;
  std::string last_seen;
};
