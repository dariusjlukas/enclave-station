#pragma once
#include <string>

struct Message {
    std::string id;
    std::string channel_id;
    std::string user_id;
    std::string username;
    std::string content;
    std::string created_at;
    std::string edited_at;
    bool is_deleted = false;
};
