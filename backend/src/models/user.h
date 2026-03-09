#pragma once
#include <string>

struct User {
    std::string id;
    std::string username;
    std::string display_name;
    std::string public_key;
    std::string role;
    bool is_online = false;
    std::string last_seen;
    std::string created_at;
    std::string bio;
    std::string status;
    std::string avatar_file_id;
    std::string profile_color;
};
