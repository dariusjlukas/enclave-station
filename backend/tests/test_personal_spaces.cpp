#include <gtest/gtest.h>
#include "config.h"
#include "db/database.h"

class DatabaseTest : public ::testing::Test {
protected:
    static void SetUpTestSuite() {
        auto config = Config::from_env();
        conn_string_ = config.pg_connection_string();
        db_ = std::make_unique<Database>(conn_string_);
        db_->run_migrations();
    }

    void SetUp() override {
        // Clean all data between tests (respecting FK constraints)
        pqxx::connection conn(conn_string_);
        pqxx::work txn(conn);
        txn.exec("DELETE FROM messages");
        txn.exec("DELETE FROM channel_members");
        txn.exec("DELETE FROM channels");
        txn.exec("DELETE FROM space_tools");
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
        txn.exec("DELETE FROM server_settings");
        txn.commit();
    }

    static std::unique_ptr<Database> db_;
    static std::string conn_string_;
};

std::unique_ptr<Database> DatabaseTest::db_;
std::string DatabaseTest::conn_string_;

// --- Personal Spaces ---

TEST_F(DatabaseTest, CreatePersonalSpace) {
    auto user = db_->create_user("alice", "Alice", "PEM_KEY_A");
    auto space = db_->create_personal_space(user.id, "Alice");

    EXPECT_FALSE(space.id.empty());
    EXPECT_TRUE(space.is_personal);
    EXPECT_EQ(space.personal_owner_id, user.id);
    EXPECT_FALSE(space.is_public);
    EXPECT_EQ(space.name, "Alice's Space");
}

TEST_F(DatabaseTest, FindPersonalSpace) {
    auto user = db_->create_user("bob", "Bob", "PEM_KEY_B");
    auto created = db_->create_personal_space(user.id, "Bob");

    auto found = db_->find_personal_space(user.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->id, created.id);
    EXPECT_TRUE(found->is_personal);
    EXPECT_EQ(found->personal_owner_id, user.id);

    // Non-existent user returns nullopt
    EXPECT_FALSE(db_->find_personal_space("00000000-0000-0000-0000-000000000000").has_value());
}

TEST_F(DatabaseTest, GetOrCreatePersonalSpace) {
    auto user = db_->create_user("carol", "Carol", "PEM_KEY_C");

    // First call creates the space
    auto space1 = db_->get_or_create_personal_space(user.id, "Carol");
    EXPECT_FALSE(space1.id.empty());
    EXPECT_TRUE(space1.is_personal);

    // Second call returns the same space
    auto space2 = db_->get_or_create_personal_space(user.id, "Carol");
    EXPECT_EQ(space1.id, space2.id);
}

TEST_F(DatabaseTest, SyncPersonalSpaceTools) {
    auto user = db_->create_user("dave", "Dave", "PEM_KEY_D");

    // Enable files and calendar, disable tasks and wiki via server_settings
    db_->set_setting("personal_spaces_files_enabled", "true");
    db_->set_setting("personal_spaces_calendar_enabled", "true");
    db_->set_setting("personal_spaces_tasks_enabled", "false");
    db_->set_setting("personal_spaces_wiki_enabled", "false");

    // Create personal space (tools are set based on current settings)
    auto space = db_->create_personal_space(user.id, "Dave");

    auto tools = db_->get_space_tools(space.id);
    // files and calendar should be enabled
    EXPECT_NE(std::find(tools.begin(), tools.end(), "files"), tools.end());
    EXPECT_NE(std::find(tools.begin(), tools.end(), "calendar"), tools.end());
    // tasks and wiki should NOT be enabled
    EXPECT_EQ(std::find(tools.begin(), tools.end(), "tasks"), tools.end());
    EXPECT_EQ(std::find(tools.begin(), tools.end(), "wiki"), tools.end());

    // Now change admin settings: disable files, enable tasks
    db_->set_setting("personal_spaces_files_enabled", "false");
    db_->set_setting("personal_spaces_tasks_enabled", "true");

    // Sync only force-disables admin-disallowed tools; it does NOT force-enable
    // (respects user choice to keep tools off)
    db_->sync_personal_space_tools(space.id);

    auto updated_tools = db_->get_space_tools(space.id);
    // files should now be removed (admin disallowed)
    EXPECT_EQ(std::find(updated_tools.begin(), updated_tools.end(), "files"), updated_tools.end());
    // calendar should still be present (admin still allows, was enabled at creation)
    EXPECT_NE(std::find(updated_tools.begin(), updated_tools.end(), "calendar"), updated_tools.end());
    // tasks should still be absent (admin now allows, but sync doesn't force-enable)
    EXPECT_EQ(std::find(updated_tools.begin(), updated_tools.end(), "tasks"), updated_tools.end());
    // wiki should still be absent (admin still disallows)
    EXPECT_EQ(std::find(updated_tools.begin(), updated_tools.end(), "wiki"), updated_tools.end());
}
