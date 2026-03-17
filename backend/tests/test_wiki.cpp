#include <gtest/gtest.h>
#include "config.h"
#include "db/database.h"

class WikiTest : public ::testing::Test {
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
        txn.exec("DELETE FROM space_tools");
        txn.exec("DELETE FROM space_members");
        txn.exec("DELETE FROM spaces");
        txn.exec("DELETE FROM sessions");
        txn.exec("DELETE FROM users");
        txn.exec("DELETE FROM server_settings");
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

std::unique_ptr<Database> WikiTest::db_;
std::string WikiTest::conn_string_;

// --- Wiki Pages CRUD ---

TEST_F(WikiTest, CreateWikiPage) {
    auto [user, space] = create_user_and_space();
    auto page = db_->create_wiki_page(
        space.id, "", "Getting Started", "getting-started", false,
        "<p>Hello</p>", "Hello", "📖", 0, user.id);

    EXPECT_FALSE(page.id.empty());
    EXPECT_EQ(page.title, "Getting Started");
    EXPECT_EQ(page.slug, "getting-started");
    EXPECT_FALSE(page.is_folder);
    EXPECT_EQ(page.content, "<p>Hello</p>");
    EXPECT_EQ(page.content_text, "Hello");
    EXPECT_EQ(page.icon, "📖");
    EXPECT_EQ(page.space_id, space.id);
}

TEST_F(WikiTest, FindWikiPage) {
    auto [user, space] = create_user_and_space();
    auto page = db_->create_wiki_page(
        space.id, "", "Test", "test", false, "content", "text", "", 0, user.id);

    auto found = db_->find_wiki_page(page.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->title, "Test");
    EXPECT_EQ(found->slug, "test");

    EXPECT_FALSE(db_->find_wiki_page("00000000-0000-0000-0000-000000000000").has_value());
}

TEST_F(WikiTest, UpdateWikiPage) {
    auto [user, space] = create_user_and_space();
    auto page = db_->create_wiki_page(
        space.id, "", "Original", "original", false, "old", "old", "", 0, user.id);

    auto updated = db_->update_wiki_page(
        page.id, "Updated Title", "updated-slug", "new content", "new text", "🆕", "", user.id);

    EXPECT_EQ(updated.title, "Updated Title");
    EXPECT_EQ(updated.slug, "updated-slug");
    EXPECT_EQ(updated.content, "new content");
    EXPECT_EQ(updated.icon, "🆕");
}

TEST_F(WikiTest, SoftDeleteWikiPage) {
    auto [user, space] = create_user_and_space();
    auto page = db_->create_wiki_page(
        space.id, "", "ToDelete", "to-delete", false, "", "", "", 0, user.id);

    db_->soft_delete_wiki_page(page.id);

    auto pages = db_->list_wiki_pages(space.id, "");
    EXPECT_TRUE(pages.empty());

    // Page should still exist when found by id
    auto found = db_->find_wiki_page(page.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_TRUE(found->is_deleted);
}

TEST_F(WikiTest, ListWikiPages) {
    auto [user, space] = create_user_and_space();
    db_->create_wiki_page(space.id, "", "Page A", "page-a", false, "", "", "", 0, user.id);
    db_->create_wiki_page(space.id, "", "Page B", "page-b", false, "", "", "", 1, user.id);

    auto pages = db_->list_wiki_pages(space.id, "");
    EXPECT_EQ(pages.size(), 2u);
}

TEST_F(WikiTest, CreateWikiFolder) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_wiki_page(
        space.id, "", "Docs", "docs", true, "", "", "📁", 0, user.id);

    EXPECT_TRUE(folder.is_folder);

    auto child = db_->create_wiki_page(
        space.id, folder.id, "Child Page", "child", false, "content", "text", "", 0, user.id);

    auto children = db_->list_wiki_pages(space.id, folder.id);
    ASSERT_EQ(children.size(), 1u);
    EXPECT_EQ(children[0].title, "Child Page");
}

TEST_F(WikiTest, WikiSlugExists) {
    auto [user, space] = create_user_and_space();
    db_->create_wiki_page(space.id, "", "Test", "my-slug", false, "", "", "", 0, user.id);

    EXPECT_TRUE(db_->wiki_page_slug_exists(space.id, "", "my-slug"));
    EXPECT_FALSE(db_->wiki_page_slug_exists(space.id, "", "other-slug"));
}

TEST_F(WikiTest, WikiSlugExistsExcludeId) {
    auto [user, space] = create_user_and_space();
    auto page = db_->create_wiki_page(
        space.id, "", "Test", "my-slug", false, "", "", "", 0, user.id);

    // Excluding the page's own ID should return false
    EXPECT_FALSE(db_->wiki_page_slug_exists(space.id, "", "my-slug", page.id));
}

TEST_F(WikiTest, MoveWikiPage) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_wiki_page(
        space.id, "", "Folder", "folder", true, "", "", "", 0, user.id);
    auto page = db_->create_wiki_page(
        space.id, "", "Page", "page", false, "", "", "", 0, user.id);

    // Initially at root
    auto root_pages = db_->list_wiki_pages(space.id, "");
    EXPECT_EQ(root_pages.size(), 2u);

    // Move page into folder
    db_->move_wiki_page(page.id, folder.id);

    auto new_root = db_->list_wiki_pages(space.id, "");
    EXPECT_EQ(new_root.size(), 1u);

    auto folder_children = db_->list_wiki_pages(space.id, folder.id);
    EXPECT_EQ(folder_children.size(), 1u);
    EXPECT_EQ(folder_children[0].id, page.id);
}

TEST_F(WikiTest, WikiPagePath) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_wiki_page(
        space.id, "", "Docs", "docs", true, "", "", "", 0, user.id);
    auto page = db_->create_wiki_page(
        space.id, folder.id, "Guide", "guide", false, "", "", "", 0, user.id);

    auto path = db_->get_wiki_page_path(page.id);
    ASSERT_EQ(path.size(), 2u);
    EXPECT_EQ(path[0].title, "Docs");
    EXPECT_EQ(path[1].title, "Guide");
}

TEST_F(WikiTest, WikiTree) {
    auto [user, space] = create_user_and_space();
    db_->create_wiki_page(space.id, "", "Root Page", "root", false, "", "", "", 0, user.id);
    auto folder = db_->create_wiki_page(
        space.id, "", "Folder", "folder", true, "", "", "", 1, user.id);
    db_->create_wiki_page(
        space.id, folder.id, "Nested", "nested", false, "", "", "", 0, user.id);

    auto tree = db_->get_wiki_tree(space.id);
    EXPECT_EQ(tree.size(), 3u);
}

TEST_F(WikiTest, ReorderWikiPages) {
    auto [user, space] = create_user_and_space();
    auto p1 = db_->create_wiki_page(space.id, "", "A", "a", false, "", "", "", 0, user.id);
    auto p2 = db_->create_wiki_page(space.id, "", "B", "b", false, "", "", "", 1, user.id);
    auto p3 = db_->create_wiki_page(space.id, "", "C", "c", false, "", "", "", 2, user.id);

    db_->reorder_wiki_pages({{p3.id, 0}, {p1.id, 1}, {p2.id, 2}});

    auto pages = db_->list_wiki_pages(space.id, "");
    ASSERT_EQ(pages.size(), 3u);
    EXPECT_EQ(pages[0].title, "C");
    EXPECT_EQ(pages[1].title, "A");
    EXPECT_EQ(pages[2].title, "B");
}

// --- Wiki Page Versions ---

TEST_F(WikiTest, CreateAndListVersions) {
    auto [user, space] = create_user_and_space();
    auto page = db_->create_wiki_page(
        space.id, "", "Page", "page", false, "v1 content", "v1", "", 0, user.id);

    auto v1 = db_->create_wiki_page_version(page.id, "Page", "v1 content", "v1", user.id, true);
    EXPECT_FALSE(v1.id.empty());
    EXPECT_TRUE(v1.is_major);

    db_->update_wiki_page(page.id, "Page", "page", "v2 content", "v2", "", "", user.id);
    auto v2 = db_->create_wiki_page_version(page.id, "Page", "v2 content", "v2", user.id, true);

    auto versions = db_->list_wiki_page_versions(page.id, true);
    EXPECT_GE(versions.size(), 2u);
}

TEST_F(WikiTest, GetVersion) {
    auto [user, space] = create_user_and_space();
    auto page = db_->create_wiki_page(
        space.id, "", "Page", "page", false, "content", "text", "", 0, user.id);

    auto version = db_->create_wiki_page_version(page.id, "Page", "content", "text", user.id, true);

    auto found = db_->get_wiki_page_version(version.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->content, "content");
}

// --- Wiki Permissions (space-level) ---

TEST_F(WikiTest, WikiSpacePermissions) {
    auto [owner, space] = create_user_and_space();
    auto viewer = db_->create_user("bob", "Bob", "KEY_BOB");

    db_->set_wiki_permission(space.id, viewer.id, "view", owner.id);
    EXPECT_EQ(db_->get_wiki_permission(space.id, viewer.id), "view");

    auto perms = db_->get_wiki_permissions(space.id);
    EXPECT_EQ(perms.size(), 1u);

    db_->remove_wiki_permission(space.id, viewer.id);
    EXPECT_EQ(db_->get_wiki_permission(space.id, viewer.id), "");
}

// --- Wiki Page Permissions (per-page) ---

TEST_F(WikiTest, WikiPagePermissions) {
    auto [owner, space] = create_user_and_space();
    auto viewer = db_->create_user("bob", "Bob", "KEY_BOB");
    auto page = db_->create_wiki_page(
        space.id, "", "Page", "page", false, "", "", "", 0, owner.id);

    db_->set_wiki_page_permission(page.id, viewer.id, "edit", owner.id);

    auto perm = db_->get_effective_wiki_page_permission(page.id, viewer.id);
    EXPECT_EQ(perm, "edit");

    auto perms = db_->get_wiki_page_permissions(page.id);
    ASSERT_GE(perms.size(), 1u);

    db_->remove_wiki_page_permission(page.id, viewer.id);
    // After removal, effective permission may fall back to space-level defaults
    auto after = db_->get_effective_wiki_page_permission(page.id, viewer.id);
    EXPECT_NE(after, "edit");
}
