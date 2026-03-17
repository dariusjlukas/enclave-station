#include <gtest/gtest.h>
#include "config.h"
#include "db/database.h"

class NotificationTest : public ::testing::Test {
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
        txn.exec("DELETE FROM wiki_page_versions");
        txn.exec("DELETE FROM wiki_page_permissions");
        txn.exec("DELETE FROM wiki_permissions");
        txn.exec("DELETE FROM wiki_pages");
        txn.exec("DELETE FROM notifications");
        txn.exec("DELETE FROM space_file_versions");
        txn.exec("DELETE FROM space_file_permissions");
        txn.exec("DELETE FROM space_files");
        txn.exec("DELETE FROM space_tools");
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
        User alice;
        User bob;
        Channel channel;
    };

    Setup create_users_and_channel() {
        auto alice = db_->create_user("alice", "Alice", "KEY_ALICE");
        auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
        auto channel = db_->create_channel("general", "General chat", false,
                                           alice.id, {alice.id, bob.id});
        return {alice, bob, channel};
    }

    struct SpaceSetup {
        User user;
        Space space;
    };

    SpaceSetup create_user_and_space(const std::string& username = "alice") {
        auto user = db_->create_user(username, username, "KEY_" + username);
        auto space = db_->create_space("Engineering", "Eng team", true,
                                       user.id, "write");
        return {user, space};
    }

    static std::unique_ptr<Database> db_;
    static std::string conn_string_;
};

std::unique_ptr<Database> NotificationTest::db_;
std::string NotificationTest::conn_string_;

// --- search_messages ---

TEST_F(NotificationTest, SearchMessagesFindsMatchingContent) {
    auto [alice, bob, channel] = create_users_and_channel();

    db_->create_message(channel.id, alice.id, "The quick brown fox jumps");
    db_->create_message(channel.id, bob.id, "A lazy dog sleeps");
    db_->create_message(channel.id, alice.id, "Another fox story");

    auto results = db_->search_messages(
        "websearch_to_tsquery('english', 'fox')",
        alice.id, false, 10, 0);

    ASSERT_EQ(results.size(), 2u);
    // Results are ordered by created_at DESC, so newest first
    EXPECT_EQ(results[0].content, "Another fox story");
    EXPECT_EQ(results[1].content, "The quick brown fox jumps");
}

TEST_F(NotificationTest, SearchMessagesReturnsEmptyForNoMatch) {
    auto [alice, bob, channel] = create_users_and_channel();

    db_->create_message(channel.id, alice.id, "Hello world");

    auto results = db_->search_messages(
        "websearch_to_tsquery('english', 'nonexistent')",
        alice.id, false, 10, 0);

    EXPECT_TRUE(results.empty());
}

TEST_F(NotificationTest, SearchMessagesRespectsChannelMembership) {
    auto [alice, bob, channel] = create_users_and_channel();

    // Create a third user who is NOT in the channel
    auto carol = db_->create_user("carol", "Carol", "KEY_CAROL");

    db_->create_message(channel.id, alice.id, "Secret fox message");

    // Carol should not see messages from channels she is not a member of
    auto results = db_->search_messages(
        "websearch_to_tsquery('english', 'fox')",
        carol.id, false, 10, 0);

    EXPECT_TRUE(results.empty());

    // But admin Carol can see non-DM channel messages
    auto admin_results = db_->search_messages(
        "websearch_to_tsquery('english', 'fox')",
        carol.id, true, 10, 0);

    EXPECT_EQ(admin_results.size(), 1u);
}

TEST_F(NotificationTest, SearchMessagesRespectsLimitAndOffset) {
    auto [alice, bob, channel] = create_users_and_channel();

    db_->create_message(channel.id, alice.id, "fox one");
    db_->create_message(channel.id, alice.id, "fox two");
    db_->create_message(channel.id, alice.id, "fox three");

    // Limit to 2 results
    auto page1 = db_->search_messages(
        "websearch_to_tsquery('english', 'fox')",
        alice.id, false, 2, 0);
    ASSERT_EQ(page1.size(), 2u);

    // Offset by 2 to get the remaining
    auto page2 = db_->search_messages(
        "websearch_to_tsquery('english', 'fox')",
        alice.id, false, 2, 2);
    ASSERT_EQ(page2.size(), 1u);
}

// --- browse_messages ---

TEST_F(NotificationTest, BrowseMessagesReturnsAllAccessible) {
    auto [alice, bob, channel] = create_users_and_channel();

    db_->create_message(channel.id, alice.id, "Hello");
    db_->create_message(channel.id, bob.id, "World");
    db_->create_message(channel.id, alice.id, "Goodbye");

    auto results = db_->browse_messages(alice.id, false, 10, 0);

    ASSERT_EQ(results.size(), 3u);
    // Ordered by created_at DESC
    EXPECT_EQ(results[0].content, "Goodbye");
    EXPECT_EQ(results[1].content, "World");
    EXPECT_EQ(results[2].content, "Hello");
}

TEST_F(NotificationTest, BrowseMessagesReturnsEmptyWhenNone) {
    auto [alice, bob, channel] = create_users_and_channel();

    auto results = db_->browse_messages(alice.id, false, 10, 0);
    EXPECT_TRUE(results.empty());
}

TEST_F(NotificationTest, BrowseMessagesRespectsLimitAndOffset) {
    auto [alice, bob, channel] = create_users_and_channel();

    for (int i = 0; i < 5; i++) {
        db_->create_message(channel.id, alice.id,
                            "msg" + std::to_string(i));
    }

    auto page1 = db_->browse_messages(alice.id, false, 3, 0);
    ASSERT_EQ(page1.size(), 3u);

    auto page2 = db_->browse_messages(alice.id, false, 3, 3);
    ASSERT_EQ(page2.size(), 2u);
}

TEST_F(NotificationTest, BrowseMessagesExcludesInaccessibleChannels) {
    auto [alice, bob, channel] = create_users_and_channel();
    auto carol = db_->create_user("carol", "Carol", "KEY_CAROL");

    // Create a channel carol cannot see
    auto secret_ch = db_->create_channel("secret", "", false,
                                         alice.id, {alice.id});
    db_->create_message(secret_ch.id, alice.id, "Secret stuff");
    db_->create_message(channel.id, alice.id, "Public stuff");

    auto results = db_->browse_messages(carol.id, false, 10, 0);
    EXPECT_TRUE(results.empty());
}

// --- search_files ---

TEST_F(NotificationTest, SearchFilesFindsMatchingFiles) {
    auto [alice, bob, channel] = create_users_and_channel();

    db_->create_file_message(channel.id, alice.id, "Here is a report",
                             "file-id-1", "annual_report.pdf", 1024,
                             "application/pdf");
    db_->create_file_message(channel.id, bob.id, "Here is an image",
                             "file-id-2", "photo.png", 2048,
                             "image/png");

    auto results = db_->search_files("report", alice.id, false, 10, 0);

    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].file_name, "annual_report.pdf");
    EXPECT_EQ(results[0].file_type, "application/pdf");
    EXPECT_EQ(results[0].file_size, 1024);
    EXPECT_EQ(results[0].source, "message");
}

TEST_F(NotificationTest, SearchFilesReturnsEmptyForNoMatch) {
    auto [alice, bob, channel] = create_users_and_channel();

    db_->create_file_message(channel.id, alice.id, "A file",
                             "file-id-1", "document.txt", 512,
                             "text/plain");

    auto results = db_->search_files("spreadsheet", alice.id, false, 10, 0);
    EXPECT_TRUE(results.empty());
}

TEST_F(NotificationTest, SearchFilesRespectsChannelMembership) {
    auto [alice, bob, channel] = create_users_and_channel();
    auto carol = db_->create_user("carol", "Carol", "KEY_CAROL");

    db_->create_file_message(channel.id, alice.id, "Shared file",
                             "file-id-1", "secret_doc.pdf", 1024,
                             "application/pdf");

    // Carol is not a member, should see nothing
    auto results = db_->search_files("secret", carol.id, false, 10, 0);
    EXPECT_TRUE(results.empty());

    // Admin Carol can see non-DM channel files
    auto admin_results = db_->search_files("secret", carol.id, true, 10, 0);
    EXPECT_EQ(admin_results.size(), 1u);
}

// --- search_wiki_pages ---

TEST_F(NotificationTest, SearchWikiPagesFindsMatchingContent) {
    auto [alice, space] = create_user_and_space();

    db_->create_wiki_page(space.id, "", "Getting Started",
                          "getting-started", false,
                          "{}", "Welcome to the getting started guide",
                          "", 0, alice.id);
    db_->create_wiki_page(space.id, "", "API Reference",
                          "api-reference", false,
                          "{}", "This is the API reference documentation",
                          "", 1, alice.id);

    auto results = db_->search_wiki_pages(
        "websearch_to_tsquery('english', 'getting started')",
        "getting started",
        alice.id, false, 10, 0);

    ASSERT_GE(results.size(), 1u);
    // Should find the "Getting Started" page
    bool found = false;
    for (const auto& r : results) {
        if (r.title == "Getting Started") {
            found = true;
            EXPECT_EQ(r.space_name, "Engineering");
        }
    }
    EXPECT_TRUE(found);
}

TEST_F(NotificationTest, SearchWikiPagesReturnsEmptyForNoMatch) {
    auto [alice, space] = create_user_and_space();

    db_->create_wiki_page(space.id, "", "Hello Page",
                          "hello-page", false,
                          "{}", "Hello world content",
                          "", 0, alice.id);

    auto results = db_->search_wiki_pages(
        "websearch_to_tsquery('english', 'nonexistentterm')",
        "nonexistentterm",
        alice.id, false, 10, 0);

    EXPECT_TRUE(results.empty());
}

TEST_F(NotificationTest, SearchWikiPagesRespectsSpaceMembership) {
    auto alice = db_->create_user("alice", "Alice", "KEY_ALICE");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    auto space = db_->create_space("Secret Team", "Private", false,
                                   alice.id, "write");

    db_->create_wiki_page(space.id, "", "Secret Plans",
                          "secret-plans", false,
                          "{}", "Top secret deployment plans",
                          "", 0, alice.id);

    // Bob is not a member of the space
    auto results = db_->search_wiki_pages(
        "websearch_to_tsquery('english', 'secret')",
        "secret",
        bob.id, false, 10, 0);
    EXPECT_TRUE(results.empty());

    // Admin Bob can see all wiki pages
    auto admin_results = db_->search_wiki_pages(
        "websearch_to_tsquery('english', 'secret')",
        "secret",
        bob.id, true, 10, 0);
    EXPECT_GE(admin_results.size(), 1u);
}

TEST_F(NotificationTest, SearchWikiPagesExcludesFolders) {
    auto [alice, space] = create_user_and_space();

    // Create a folder (is_folder = true)
    db_->create_wiki_page(space.id, "", "Folder Guide",
                          "folder-guide", true,
                          "{}", "This is a folder about guides",
                          "", 0, alice.id);
    // Create a page (is_folder = false)
    db_->create_wiki_page(space.id, "", "Page Guide",
                          "page-guide", false,
                          "{}", "This is a page about guides",
                          "", 1, alice.id);

    auto results = db_->search_wiki_pages(
        "websearch_to_tsquery('english', 'guide')",
        "guide",
        alice.id, false, 10, 0);

    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].title, "Page Guide");
}

// --- browse_wiki_pages ---

TEST_F(NotificationTest, BrowseWikiPagesReturnsAll) {
    auto [alice, space] = create_user_and_space();

    db_->create_wiki_page(space.id, "", "Page One",
                          "page-one", false,
                          "{}", "First page content",
                          "", 0, alice.id);
    db_->create_wiki_page(space.id, "", "Page Two",
                          "page-two", false,
                          "{}", "Second page content",
                          "", 1, alice.id);

    auto results = db_->browse_wiki_pages(alice.id, false, 10, 0);

    ASSERT_EQ(results.size(), 2u);
}

TEST_F(NotificationTest, BrowseWikiPagesReturnsEmptyWhenNone) {
    auto [alice, space] = create_user_and_space();

    auto results = db_->browse_wiki_pages(alice.id, false, 10, 0);
    EXPECT_TRUE(results.empty());
}

TEST_F(NotificationTest, BrowseWikiPagesRespectsLimitAndOffset) {
    auto [alice, space] = create_user_and_space();

    for (int i = 0; i < 5; i++) {
        db_->create_wiki_page(space.id, "", "Page " + std::to_string(i),
                              "page-" + std::to_string(i), false,
                              "{}", "Content " + std::to_string(i),
                              "", i, alice.id);
    }

    auto page1 = db_->browse_wiki_pages(alice.id, false, 3, 0);
    ASSERT_EQ(page1.size(), 3u);

    auto page2 = db_->browse_wiki_pages(alice.id, false, 3, 3);
    ASSERT_EQ(page2.size(), 2u);
}

TEST_F(NotificationTest, BrowseWikiPagesExcludesFolders) {
    auto [alice, space] = create_user_and_space();

    db_->create_wiki_page(space.id, "", "A Folder",
                          "a-folder", true,
                          "{}", "Folder content",
                          "", 0, alice.id);
    db_->create_wiki_page(space.id, "", "A Page",
                          "a-page", false,
                          "{}", "Page content",
                          "", 1, alice.id);

    auto results = db_->browse_wiki_pages(alice.id, false, 10, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].title, "A Page");
}

// --- get_file_info ---

TEST_F(NotificationTest, GetFileInfoForMessageAttachment) {
    auto [alice, bob, channel] = create_users_and_channel();

    db_->create_file_message(channel.id, alice.id, "A file",
                             "file-uuid-123", "report.pdf", 4096,
                             "application/pdf");

    auto info = db_->get_file_info("file-uuid-123");

    ASSERT_TRUE(info.has_value());
    EXPECT_EQ(info->file_name, "report.pdf");
    EXPECT_EQ(info->file_type, "application/pdf");
}

TEST_F(NotificationTest, GetFileInfoReturnsNulloptForUnknownId) {
    auto info = db_->get_file_info("nonexistent-file-id");
    EXPECT_FALSE(info.has_value());
}

TEST_F(NotificationTest, GetFileInfoForSpaceFile) {
    auto [alice, space] = create_user_and_space();

    db_->create_space_file(space.id, "", "design.png",
                           "disk-file-id-456", 8192,
                           "image/png", alice.id);

    auto info = db_->get_file_info("disk-file-id-456");

    ASSERT_TRUE(info.has_value());
    EXPECT_EQ(info->file_name, "design.png");
    EXPECT_EQ(info->file_type, "image/png");
}
