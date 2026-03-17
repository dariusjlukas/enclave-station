#pragma once
#include <string>
#include <vector>

struct TaskBoard {
  std::string id;
  std::string space_id;
  std::string name;
  std::string description;
  std::string created_by;
  std::string created_by_username;
  std::string created_at;
  std::string updated_at;
};

struct TaskColumn {
  std::string id;
  std::string board_id;
  std::string name;
  int position = 0;
  int wip_limit = 0;  // 0 = no limit
  std::string color;
  std::string created_at;
};

struct Task {
  std::string id;
  std::string board_id;
  std::string column_id;
  std::string title;
  std::string description;
  std::string priority;  // low, medium, high, critical
  std::string due_date;
  std::string start_date;
  int duration_days = 0;
  std::string color;
  int position = 0;
  std::string created_by;
  std::string created_by_username;
  std::string created_at;
  std::string updated_at;
};

struct TaskDependency {
  std::string id;
  std::string task_id;        // the dependent task
  std::string depends_on_id;  // the prerequisite task
  std::string
    dependency_type;  // finish_to_start, start_to_start, finish_to_finish, start_to_finish
  std::string created_at;
};

struct TaskAssignee {
  std::string task_id;
  std::string user_id;
  std::string username;
  std::string display_name;
};

struct TaskLabel {
  std::string id;
  std::string board_id;
  std::string name;
  std::string color;
};

struct TaskChecklist {
  std::string id;
  std::string task_id;
  std::string title;
  int position = 0;
};

struct TaskChecklistItem {
  std::string id;
  std::string checklist_id;
  std::string content;
  bool is_checked = false;
  int position = 0;
};

struct TaskActivity {
  std::string id;
  std::string task_id;
  std::string user_id;
  std::string username;
  std::string display_name;
  std::string action;   // created, moved, assigned, unassigned, priority_changed, etc.
  std::string details;  // JSON with before/after values
  std::string created_at;
};

struct TaskBoardPermission {
  std::string id;
  std::string space_id;
  std::string user_id;
  std::string username;
  std::string display_name;
  std::string permission;  // owner, edit, view
  std::string granted_by;
  std::string granted_by_username;
  std::string created_at;
};
