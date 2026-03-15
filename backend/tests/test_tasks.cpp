#include <gtest/gtest.h>
#include "config.h"
#include "db/database.h"

class TaskBoardTest : public ::testing::Test {
protected:
    static void SetUpTestSuite() {
        auto config = Config::from_env();
        conn_string_ = config.pg_connection_string();
        db_ = std::make_unique<Database>(conn_string_);
        db_->run_migrations();
    }

    void SetUp() override {
        pqxx::connection conn(conn_string_);
        pqxx::work txn(conn);
        txn.exec("DELETE FROM task_dependencies");
        txn.exec("DELETE FROM task_activity");
        txn.exec("DELETE FROM task_checklist_items");
        txn.exec("DELETE FROM task_checklists");
        txn.exec("DELETE FROM task_label_assignments");
        txn.exec("DELETE FROM task_labels");
        txn.exec("DELETE FROM task_assignees");
        txn.exec("DELETE FROM tasks");
        txn.exec("DELETE FROM task_columns");
        txn.exec("DELETE FROM task_boards");
        txn.exec("DELETE FROM task_board_permissions");
        txn.exec("DELETE FROM calendar_event_rsvps");
        txn.exec("DELETE FROM calendar_event_exceptions");
        txn.exec("DELETE FROM calendar_permissions");
        txn.exec("DELETE FROM calendar_events");
        txn.exec("DELETE FROM space_file_versions");
        txn.exec("DELETE FROM space_file_permissions");
        txn.exec("DELETE FROM space_files");
        txn.exec("DELETE FROM messages");
        txn.exec("DELETE FROM channel_members");
        txn.exec("DELETE FROM channels");
        txn.exec("DELETE FROM space_invites");
        txn.exec("DELETE FROM space_members");
        txn.exec("DELETE FROM spaces");
        txn.exec("DELETE FROM sessions");
        txn.exec("DELETE FROM auth_challenges");
        txn.exec("DELETE FROM device_tokens");
        txn.exec("DELETE FROM user_keys");
        txn.exec("DELETE FROM invite_tokens");
        txn.exec("DELETE FROM join_requests");
        txn.exec("DELETE FROM users");
        txn.commit();
    }

    struct Setup {
        User user;
        Space space;
    };
    Setup create_user_and_space(const std::string& username = "alice") {
        auto user = db_->create_user(username, username, "KEY_" + username);
        auto space = db_->create_space("TestSpace", "desc", true, user.id, "write");
        return {user, space};
    }

    static std::unique_ptr<Database> db_;
    static std::string conn_string_;
};

std::unique_ptr<Database> TaskBoardTest::db_;
std::string TaskBoardTest::conn_string_;

// --- Board CRUD ---

TEST_F(TaskBoardTest, CreateBoard) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Sprint 1", "First sprint", user.id);

    EXPECT_FALSE(board.id.empty());
    EXPECT_EQ(board.name, "Sprint 1");
    EXPECT_EQ(board.description, "First sprint");
    EXPECT_EQ(board.space_id, space.id);
    EXPECT_EQ(board.created_by, user.id);
}

TEST_F(TaskBoardTest, ListBoards) {
    auto [user, space] = create_user_and_space();
    db_->create_task_board(space.id, "Board A", "", user.id);
    db_->create_task_board(space.id, "Board B", "", user.id);

    auto boards = db_->list_task_boards(space.id);
    EXPECT_EQ(boards.size(), 2u);
}

TEST_F(TaskBoardTest, FindBoard) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Find Me", "", user.id);

    auto found = db_->find_task_board(board.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->name, "Find Me");
}

TEST_F(TaskBoardTest, FindBoardNotFound) {
    auto found = db_->find_task_board("00000000-0000-0000-0000-000000000000");
    EXPECT_FALSE(found.has_value());
}

TEST_F(TaskBoardTest, UpdateBoard) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Old Name", "old desc", user.id);

    auto updated = db_->update_task_board(board.id, "New Name", "new desc");
    EXPECT_EQ(updated.name, "New Name");
    EXPECT_EQ(updated.description, "new desc");
}

TEST_F(TaskBoardTest, DeleteBoard) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Delete Me", "", user.id);

    db_->delete_task_board(board.id);
    auto found = db_->find_task_board(board.id);
    EXPECT_FALSE(found.has_value());
}

// --- Column CRUD ---

TEST_F(TaskBoardTest, CreateColumn) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);

    auto col = db_->create_task_column(board.id, "To Do", 0, 5, "blue");
    EXPECT_FALSE(col.id.empty());
    EXPECT_EQ(col.name, "To Do");
    EXPECT_EQ(col.position, 0);
    EXPECT_EQ(col.wip_limit, 5);
}

TEST_F(TaskBoardTest, ListColumns) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);

    db_->create_task_column(board.id, "To Do", 0, 0, "");
    db_->create_task_column(board.id, "In Progress", 1, 0, "");
    db_->create_task_column(board.id, "Done", 2, 0, "");

    auto cols = db_->list_task_columns(board.id);
    EXPECT_EQ(cols.size(), 3u);
    EXPECT_EQ(cols[0].name, "To Do");
    EXPECT_EQ(cols[1].name, "In Progress");
    EXPECT_EQ(cols[2].name, "Done");
}

TEST_F(TaskBoardTest, UpdateColumn) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "Old", 0, 0, "");

    auto updated = db_->update_task_column(col.id, "New", 3, "red");
    EXPECT_EQ(updated.name, "New");
    EXPECT_EQ(updated.wip_limit, 3);
}

TEST_F(TaskBoardTest, ReorderColumns) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto c1 = db_->create_task_column(board.id, "A", 0, 0, "");
    auto c2 = db_->create_task_column(board.id, "B", 1, 0, "");
    auto c3 = db_->create_task_column(board.id, "C", 2, 0, "");

    db_->reorder_task_columns(board.id, {c3.id, c1.id, c2.id});

    auto cols = db_->list_task_columns(board.id);
    EXPECT_EQ(cols[0].name, "C");
    EXPECT_EQ(cols[1].name, "A");
    EXPECT_EQ(cols[2].name, "B");
}

TEST_F(TaskBoardTest, DeleteColumn) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "Delete Me", 0, 0, "");

    db_->delete_task_column(col.id);
    auto cols = db_->list_task_columns(board.id);
    EXPECT_EQ(cols.size(), 0u);
}

// --- Task CRUD ---

TEST_F(TaskBoardTest, CreateTask) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");

    auto task = db_->create_task(board.id, col.id, "My Task", "Description",
                                  "high", "2026-04-01T00:00:00Z", "", 0, user.id,
                                  "2026-03-15T00:00:00Z", 5);

    EXPECT_FALSE(task.id.empty());
    EXPECT_EQ(task.title, "My Task");
    EXPECT_EQ(task.priority, "high");
    EXPECT_EQ(task.duration_days, 5);
    EXPECT_FALSE(task.start_date.empty());
}

TEST_F(TaskBoardTest, ListTasks) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");

    db_->create_task(board.id, col.id, "Task 1", "", "medium", "", "", 0, user.id);
    db_->create_task(board.id, col.id, "Task 2", "", "high", "", "", 1, user.id);

    auto tasks = db_->list_tasks(board.id);
    EXPECT_EQ(tasks.size(), 2u);
}

TEST_F(TaskBoardTest, FindTask) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Find Me", "", "low", "", "", 0, user.id);

    auto found = db_->find_task(task.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->title, "Find Me");
    EXPECT_EQ(found->priority, "low");
}

TEST_F(TaskBoardTest, UpdateTask) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col1 = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto col2 = db_->create_task_column(board.id, "Done", 1, 0, "");
    auto task = db_->create_task(board.id, col1.id, "Old", "", "low", "", "", 0, user.id);

    auto updated = db_->update_task(task.id, col2.id, "New", "updated desc",
                                      "critical", "2026-05-01T00:00:00Z", "red", 0,
                                      "2026-04-01T00:00:00Z", 10);

    EXPECT_EQ(updated.title, "New");
    EXPECT_EQ(updated.column_id, col2.id);
    EXPECT_EQ(updated.priority, "critical");
    EXPECT_EQ(updated.duration_days, 10);
}

TEST_F(TaskBoardTest, DeleteTask) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Delete Me", "", "medium", "", "", 0, user.id);

    db_->delete_task(task.id);
    auto found = db_->find_task(task.id);
    EXPECT_FALSE(found.has_value());
}

TEST_F(TaskBoardTest, GetColumnTaskCount) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");

    db_->create_task(board.id, col.id, "T1", "", "medium", "", "", 0, user.id);
    db_->create_task(board.id, col.id, "T2", "", "medium", "", "", 1, user.id);

    EXPECT_EQ(db_->get_column_task_count(col.id), 2);
}

// --- Assignees ---

TEST_F(TaskBoardTest, AddAndGetAssignees) {
    auto [alice, space] = create_user_and_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    auto board = db_->create_task_board(space.id, "Board", "", alice.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, alice.id);

    db_->add_task_assignee(task.id, alice.id);
    db_->add_task_assignee(task.id, bob.id);

    auto assignees = db_->get_task_assignees(task.id);
    EXPECT_EQ(assignees.size(), 2u);
}

TEST_F(TaskBoardTest, RemoveAssignee) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);

    db_->add_task_assignee(task.id, user.id);
    db_->remove_task_assignee(task.id, user.id);

    auto assignees = db_->get_task_assignees(task.id);
    EXPECT_EQ(assignees.size(), 0u);
}

TEST_F(TaskBoardTest, DuplicateAssigneeIgnored) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);

    db_->add_task_assignee(task.id, user.id);
    db_->add_task_assignee(task.id, user.id);

    auto assignees = db_->get_task_assignees(task.id);
    EXPECT_EQ(assignees.size(), 1u);
}

// --- Labels ---

TEST_F(TaskBoardTest, CreateAndListLabels) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);

    db_->create_task_label(board.id, "Bug", "#ef4444");
    db_->create_task_label(board.id, "Feature", "#3b82f6");

    auto labels = db_->list_task_labels(board.id);
    EXPECT_EQ(labels.size(), 2u);
}

TEST_F(TaskBoardTest, AssignAndGetTaskLabels) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);
    auto label = db_->create_task_label(board.id, "Bug", "#ef4444");

    db_->assign_task_label(task.id, label.id);
    auto labels = db_->get_task_labels(task.id);
    EXPECT_EQ(labels.size(), 1u);
    EXPECT_EQ(labels[0].name, "Bug");
}

TEST_F(TaskBoardTest, UnassignLabel) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);
    auto label = db_->create_task_label(board.id, "Bug", "#ef4444");

    db_->assign_task_label(task.id, label.id);
    db_->unassign_task_label(task.id, label.id);

    auto labels = db_->get_task_labels(task.id);
    EXPECT_EQ(labels.size(), 0u);
}

// --- Checklists ---

TEST_F(TaskBoardTest, CreateChecklist) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);

    auto cl = db_->create_task_checklist(task.id, "Pre-deploy", 0);
    EXPECT_FALSE(cl.id.empty());
    EXPECT_EQ(cl.title, "Pre-deploy");
}

TEST_F(TaskBoardTest, ChecklistItems) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);
    auto cl = db_->create_task_checklist(task.id, "Checklist", 0);

    auto item1 = db_->create_checklist_item(cl.id, "Step 1", 0);
    auto item2 = db_->create_checklist_item(cl.id, "Step 2", 1);

    auto items = db_->get_checklist_items(cl.id);
    EXPECT_EQ(items.size(), 2u);
    EXPECT_FALSE(items[0].is_checked);

    // Check off an item
    auto updated = db_->update_checklist_item(item1.id, "Step 1", true);
    EXPECT_TRUE(updated.is_checked);
}

TEST_F(TaskBoardTest, DeleteChecklistCascadesItems) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);
    auto cl = db_->create_task_checklist(task.id, "Checklist", 0);
    db_->create_checklist_item(cl.id, "Item", 0);

    db_->delete_task_checklist(cl.id);
    auto items = db_->get_checklist_items(cl.id);
    EXPECT_EQ(items.size(), 0u);
}

// --- Activity ---

TEST_F(TaskBoardTest, LogAndGetActivity) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);

    db_->log_task_activity(task.id, user.id, "created", R"({"title":"Task"})");
    db_->log_task_activity(task.id, user.id, "moved", R"({"from":"To Do","to":"Done"})");

    auto activity = db_->get_task_activity(task.id);
    EXPECT_EQ(activity.size(), 2u);
    // Most recent first
    EXPECT_EQ(activity[0].action, "moved");
    EXPECT_EQ(activity[1].action, "created");
}

// --- Dependencies ---

TEST_F(TaskBoardTest, AddDependency) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto t1 = db_->create_task(board.id, col.id, "Task 1", "", "medium", "", "", 0, user.id);
    auto t2 = db_->create_task(board.id, col.id, "Task 2", "", "medium", "", "", 1, user.id);

    auto dep = db_->add_task_dependency(t2.id, t1.id, "finish_to_start");
    EXPECT_FALSE(dep.id.empty());
    EXPECT_EQ(dep.task_id, t2.id);
    EXPECT_EQ(dep.depends_on_id, t1.id);
    EXPECT_EQ(dep.dependency_type, "finish_to_start");
}

TEST_F(TaskBoardTest, GetDependencies) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto t1 = db_->create_task(board.id, col.id, "T1", "", "medium", "", "", 0, user.id);
    auto t2 = db_->create_task(board.id, col.id, "T2", "", "medium", "", "", 1, user.id);
    auto t3 = db_->create_task(board.id, col.id, "T3", "", "medium", "", "", 2, user.id);

    db_->add_task_dependency(t2.id, t1.id);
    db_->add_task_dependency(t3.id, t2.id);

    auto deps = db_->get_task_dependencies(board.id);
    EXPECT_EQ(deps.size(), 2u);
}

TEST_F(TaskBoardTest, RemoveDependency) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto t1 = db_->create_task(board.id, col.id, "T1", "", "medium", "", "", 0, user.id);
    auto t2 = db_->create_task(board.id, col.id, "T2", "", "medium", "", "", 1, user.id);

    auto dep = db_->add_task_dependency(t2.id, t1.id);
    db_->remove_task_dependency(dep.id);

    auto deps = db_->get_task_dependencies(board.id);
    EXPECT_EQ(deps.size(), 0u);
}

TEST_F(TaskBoardTest, DuplicateDependencyUpserts) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto t1 = db_->create_task(board.id, col.id, "T1", "", "medium", "", "", 0, user.id);
    auto t2 = db_->create_task(board.id, col.id, "T2", "", "medium", "", "", 1, user.id);

    db_->add_task_dependency(t2.id, t1.id, "finish_to_start");
    db_->add_task_dependency(t2.id, t1.id, "start_to_start");

    auto deps = db_->get_task_dependencies(board.id);
    EXPECT_EQ(deps.size(), 1u);
    EXPECT_EQ(deps[0].dependency_type, "start_to_start");
}

// --- Permissions ---

TEST_F(TaskBoardTest, SetAndGetPermission) {
    auto [alice, space] = create_user_and_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    db_->add_space_member(space.id, bob.id, "read");

    db_->set_task_permission(space.id, bob.id, "edit", alice.id);

    auto perm = db_->get_task_permission(space.id, bob.id);
    EXPECT_EQ(perm, "edit");
}

TEST_F(TaskBoardTest, UpsertPermission) {
    auto [alice, space] = create_user_and_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    db_->add_space_member(space.id, bob.id, "read");

    db_->set_task_permission(space.id, bob.id, "view", alice.id);
    db_->set_task_permission(space.id, bob.id, "owner", alice.id);

    auto perm = db_->get_task_permission(space.id, bob.id);
    EXPECT_EQ(perm, "owner");
}

TEST_F(TaskBoardTest, RemovePermission) {
    auto [alice, space] = create_user_and_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    db_->add_space_member(space.id, bob.id, "read");

    db_->set_task_permission(space.id, bob.id, "edit", alice.id);
    db_->remove_task_permission(space.id, bob.id);

    auto perm = db_->get_task_permission(space.id, bob.id);
    EXPECT_TRUE(perm.empty());
}

TEST_F(TaskBoardTest, GetAllPermissions) {
    auto [alice, space] = create_user_and_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    auto carol = db_->create_user("carol", "Carol", "KEY_CAROL");
    db_->add_space_member(space.id, bob.id, "read");
    db_->add_space_member(space.id, carol.id, "read");

    db_->set_task_permission(space.id, bob.id, "edit", alice.id);
    db_->set_task_permission(space.id, carol.id, "owner", alice.id);

    auto perms = db_->get_task_permissions(space.id);
    EXPECT_EQ(perms.size(), 2u);
}

TEST_F(TaskBoardTest, NoPermissionReturnsEmpty) {
    auto [alice, space] = create_user_and_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");

    auto perm = db_->get_task_permission(space.id, bob.id);
    EXPECT_TRUE(perm.empty());
}

// --- Cascade deletes ---

TEST_F(TaskBoardTest, DeleteBoardCascadesTasks) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);

    db_->delete_task_board(board.id);

    auto tasks = db_->list_tasks(board.id);
    EXPECT_EQ(tasks.size(), 0u);
    auto cols = db_->list_task_columns(board.id);
    EXPECT_EQ(cols.size(), 0u);
}

TEST_F(TaskBoardTest, DeleteTaskCascadesAssignees) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto task = db_->create_task(board.id, col.id, "Task", "", "medium", "", "", 0, user.id);
    db_->add_task_assignee(task.id, user.id);

    db_->delete_task(task.id);

    auto assignees = db_->get_task_assignees(task.id);
    EXPECT_EQ(assignees.size(), 0u);
}

TEST_F(TaskBoardTest, DeleteTaskCascadesDependencies) {
    auto [user, space] = create_user_and_space();
    auto board = db_->create_task_board(space.id, "Board", "", user.id);
    auto col = db_->create_task_column(board.id, "To Do", 0, 0, "");
    auto t1 = db_->create_task(board.id, col.id, "T1", "", "medium", "", "", 0, user.id);
    auto t2 = db_->create_task(board.id, col.id, "T2", "", "medium", "", "", 1, user.id);
    db_->add_task_dependency(t2.id, t1.id);

    db_->delete_task(t1.id);

    auto deps = db_->get_task_dependencies(board.id);
    EXPECT_EQ(deps.size(), 0u);
}
