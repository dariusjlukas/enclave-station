#include <gtest/gtest.h>
#include "config.h"
#include "db/database.h"

class SpaceFileTest : public ::testing::Test {
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

    // Helper: create a user and space, return {user, space}
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

std::unique_ptr<Database> SpaceFileTest::db_;
std::string SpaceFileTest::conn_string_;

// --- Folder and File CRUD ---

TEST_F(SpaceFileTest, CreateFolder) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "Documents", user.id);

    EXPECT_FALSE(folder.id.empty());
    EXPECT_EQ(folder.name, "Documents");
    EXPECT_TRUE(folder.is_folder);
    EXPECT_EQ(folder.space_id, space.id);
    EXPECT_EQ(folder.created_by, user.id);
}

TEST_F(SpaceFileTest, CreateFile) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "readme.md",
                                        "disk123", 1024, "text/markdown", user.id);

    EXPECT_FALSE(file.id.empty());
    EXPECT_EQ(file.name, "readme.md");
    EXPECT_FALSE(file.is_folder);
    EXPECT_EQ(file.file_size, 1024);
    EXPECT_EQ(file.mime_type, "text/markdown");
}

TEST_F(SpaceFileTest, ListFiles) {
    auto [user, space] = create_user_and_space();
    db_->create_space_folder(space.id, "", "Folder1", user.id);
    db_->create_space_file(space.id, "", "file.txt",
                           "disk1", 100, "text/plain", user.id);

    auto files = db_->list_space_files(space.id, "");
    EXPECT_EQ(files.size(), 2u);
}

TEST_F(SpaceFileTest, ListFilesInSubfolder) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "Docs", user.id);
    db_->create_space_file(space.id, folder.id, "inner.txt",
                           "disk1", 50, "text/plain", user.id);

    auto root_files = db_->list_space_files(space.id, "");
    EXPECT_EQ(root_files.size(), 1u);  // just the folder

    auto inner_files = db_->list_space_files(space.id, folder.id);
    EXPECT_EQ(inner_files.size(), 1u);
    EXPECT_EQ(inner_files[0].name, "inner.txt");
}

TEST_F(SpaceFileTest, RenameFile) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "old.txt",
                                        "disk1", 100, "text/plain", user.id);
    db_->rename_space_file(file.id, "new.txt");

    auto found = db_->find_space_file(file.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->name, "new.txt");
}

TEST_F(SpaceFileTest, MoveFile) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "Target", user.id);
    auto file = db_->create_space_file(space.id, "", "moveme.txt",
                                        "disk1", 100, "text/plain", user.id);
    db_->move_space_file(file.id, folder.id);

    auto found = db_->find_space_file(file.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->parent_id, folder.id);
}

TEST_F(SpaceFileTest, SoftDelete) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "delete.txt",
                                        "disk1", 100, "text/plain", user.id);
    db_->soft_delete_space_file(file.id);

    auto found = db_->find_space_file(file.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_TRUE(found->is_deleted);

    // Deleted file should not appear in listings
    auto files = db_->list_space_files(space.id, "");
    EXPECT_EQ(files.size(), 0u);
}

TEST_F(SpaceFileTest, NameExistsCheck) {
    auto [user, space] = create_user_and_space();
    db_->create_space_file(space.id, "", "exists.txt",
                           "disk1", 100, "text/plain", user.id);

    EXPECT_TRUE(db_->space_file_name_exists(space.id, "", "exists.txt"));
    EXPECT_FALSE(db_->space_file_name_exists(space.id, "", "other.txt"));
}

TEST_F(SpaceFileTest, GetFilePath) {
    auto [user, space] = create_user_and_space();
    auto f1 = db_->create_space_folder(space.id, "", "A", user.id);
    auto f2 = db_->create_space_folder(space.id, f1.id, "B", user.id);
    auto file = db_->create_space_file(space.id, f2.id, "deep.txt",
                                        "disk1", 10, "text/plain", user.id);

    auto path = db_->get_space_file_path(file.id);
    ASSERT_EQ(path.size(), 3u);
    EXPECT_EQ(path[0].name, "A");
    EXPECT_EQ(path[1].name, "B");
    EXPECT_EQ(path[2].name, "deep.txt");
}

// --- Permissions ---

TEST_F(SpaceFileTest, AutoGrantOwnerOnFolderCreate) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "Docs", user.id);

    auto perms = db_->get_file_permissions(folder.id);
    ASSERT_EQ(perms.size(), 1u);
    EXPECT_EQ(perms[0].user_id, user.id);
    EXPECT_EQ(perms[0].permission, "owner");
}

TEST_F(SpaceFileTest, AutoGrantOwnerOnFileCreate) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "file.txt",
                                        "disk1", 100, "text/plain", user.id);

    auto perms = db_->get_file_permissions(file.id);
    ASSERT_EQ(perms.size(), 1u);
    EXPECT_EQ(perms[0].user_id, user.id);
    EXPECT_EQ(perms[0].permission, "owner");
}

TEST_F(SpaceFileTest, SetAndGetPermission) {
    auto [user, space] = create_user_and_space();
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    db_->add_space_member(space.id, bob.id, "user");

    auto folder = db_->create_space_folder(space.id, "", "Shared", user.id);

    db_->set_file_permission(folder.id, bob.id, "edit", user.id);

    auto perms = db_->get_file_permissions(folder.id);
    EXPECT_EQ(perms.size(), 2u);  // alice (owner) + bob (edit)

    bool found_bob = false;
    for (const auto& p : perms) {
        if (p.user_id == bob.id) {
            EXPECT_EQ(p.permission, "edit");
            found_bob = true;
        }
    }
    EXPECT_TRUE(found_bob);
}

TEST_F(SpaceFileTest, UpsertPermission) {
    auto [user, space] = create_user_and_space();
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    db_->add_space_member(space.id, bob.id, "user");

    auto folder = db_->create_space_folder(space.id, "", "Shared", user.id);

    db_->set_file_permission(folder.id, bob.id, "view", user.id);
    db_->set_file_permission(folder.id, bob.id, "owner", user.id);

    auto perms = db_->get_file_permissions(folder.id);
    for (const auto& p : perms) {
        if (p.user_id == bob.id) {
            EXPECT_EQ(p.permission, "owner");
        }
    }
}

TEST_F(SpaceFileTest, RemovePermission) {
    auto [user, space] = create_user_and_space();
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    db_->add_space_member(space.id, bob.id, "user");

    auto folder = db_->create_space_folder(space.id, "", "Shared", user.id);
    db_->set_file_permission(folder.id, bob.id, "edit", user.id);
    db_->remove_file_permission(folder.id, bob.id);

    auto perms = db_->get_file_permissions(folder.id);
    // Should only have alice's auto-granted owner permission
    EXPECT_EQ(perms.size(), 1u);
    EXPECT_EQ(perms[0].user_id, user.id);
}

TEST_F(SpaceFileTest, GetEffectivePermissionDirect) {
    auto [user, space] = create_user_and_space();
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    db_->add_space_member(space.id, bob.id, "user");

    auto folder = db_->create_space_folder(space.id, "", "Shared", user.id);
    db_->set_file_permission(folder.id, bob.id, "edit", user.id);

    auto perm = db_->get_effective_file_permission(folder.id, bob.id);
    EXPECT_EQ(perm, "edit");
}

TEST_F(SpaceFileTest, GetEffectivePermissionInherited) {
    auto [user, space] = create_user_and_space();
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    db_->add_space_member(space.id, bob.id, "user");

    auto parent = db_->create_space_folder(space.id, "", "Parent", user.id);
    db_->set_file_permission(parent.id, bob.id, "edit", user.id);

    auto child = db_->create_space_folder(space.id, parent.id, "Child", user.id);

    // Child has no explicit permission for bob, but inherits from parent
    auto perm = db_->get_effective_file_permission(child.id, bob.id);
    EXPECT_EQ(perm, "edit");
}

TEST_F(SpaceFileTest, GetEffectivePermissionCreatorFallback) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "MyFolder", user.id);

    auto perm = db_->get_effective_file_permission(folder.id, user.id);
    EXPECT_EQ(perm, "owner");
}

// --- Versions ---

TEST_F(SpaceFileTest, FileCreationCreatesVersion) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "versioned.txt",
                                        "disk_v1", 100, "text/plain", user.id);

    auto versions = db_->list_file_versions(file.id);
    ASSERT_EQ(versions.size(), 1u);
    EXPECT_EQ(versions[0].version_number, 1);
    EXPECT_EQ(versions[0].file_size, 100);
}

TEST_F(SpaceFileTest, CreateNewVersion) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "versioned.txt",
                                        "disk_v1", 100, "text/plain", user.id);

    auto v2 = db_->create_file_version(file.id, "disk_v2", 200, "text/plain", user.id);
    EXPECT_EQ(v2.version_number, 2);
    EXPECT_EQ(v2.file_size, 200);

    // File's main record should be updated
    auto found = db_->find_space_file(file.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->file_size, 200);
    EXPECT_EQ(found->disk_file_id, "disk_v2");
}

TEST_F(SpaceFileTest, ListVersionsDescending) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "multi.txt",
                                        "disk_v1", 100, "text/plain", user.id);
    db_->create_file_version(file.id, "disk_v2", 200, "text/plain", user.id);
    db_->create_file_version(file.id, "disk_v3", 300, "text/plain", user.id);

    auto versions = db_->list_file_versions(file.id);
    ASSERT_EQ(versions.size(), 3u);
    EXPECT_EQ(versions[0].version_number, 3);  // newest first
    EXPECT_EQ(versions[1].version_number, 2);
    EXPECT_EQ(versions[2].version_number, 1);
}

TEST_F(SpaceFileTest, GetFileVersion) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "file.txt",
                                        "disk1", 100, "text/plain", user.id);
    auto versions = db_->list_file_versions(file.id);
    ASSERT_EQ(versions.size(), 1u);

    auto v = db_->get_file_version(versions[0].id);
    ASSERT_TRUE(v.has_value());
    EXPECT_EQ(v->file_id, file.id);
    EXPECT_EQ(v->version_number, 1);
}

TEST_F(SpaceFileTest, GetFileVersionNotFound) {
    auto v = db_->get_file_version("00000000-0000-0000-0000-000000000000");
    EXPECT_FALSE(v.has_value());
}

// --- Storage ---

TEST_F(SpaceFileTest, SpaceStorageUsed) {
    auto [user, space] = create_user_and_space();
    db_->create_space_file(space.id, "", "a.txt", "d1", 1000, "text/plain", user.id);
    db_->create_space_file(space.id, "", "b.txt", "d2", 2000, "text/plain", user.id);

    int64_t used = db_->get_space_storage_used(space.id);
    EXPECT_EQ(used, 3000);
}

TEST_F(SpaceFileTest, GetAllSpaceStorage) {
    auto [user, space] = create_user_and_space();
    db_->create_space_file(space.id, "", "a.txt", "d1", 500, "text/plain", user.id);

    auto bob = db_->create_user("bob", "Bob", "KEY_BOB", "admin");
    auto space2 = db_->create_space("Space2", "", true, bob.id, "write");
    db_->create_space_file(space2.id, "", "b.txt", "d2", 1500, "text/plain", bob.id);

    auto all = db_->get_all_space_storage();
    EXPECT_GE(all.size(), 2u);

    int64_t total = 0;
    for (const auto& s : all) total += s.storage_used;
    EXPECT_EQ(total, 2000);
}

// --- Recursive listing (for zip download) ---

TEST_F(SpaceFileTest, ListFilesRecursiveFlat) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "Docs", user.id);
    db_->create_space_file(space.id, folder.id, "a.txt", "d1", 10, "text/plain", user.id);
    db_->create_space_file(space.id, folder.id, "b.txt", "d2", 20, "text/plain", user.id);

    auto entries = db_->list_space_files_recursive(space.id, folder.id);
    ASSERT_EQ(entries.size(), 2u);
    // Sorted by relative_path
    EXPECT_EQ(entries[0].relative_path, "a.txt");
    EXPECT_EQ(entries[1].relative_path, "b.txt");
    EXPECT_EQ(entries[0].disk_file_id, "d1");
    EXPECT_EQ(entries[1].disk_file_id, "d2");
}

TEST_F(SpaceFileTest, ListFilesRecursiveNested) {
    auto [user, space] = create_user_and_space();
    auto root = db_->create_space_folder(space.id, "", "Root", user.id);
    auto sub = db_->create_space_folder(space.id, root.id, "Sub", user.id);
    db_->create_space_file(space.id, root.id, "top.txt", "d1", 10, "text/plain", user.id);
    db_->create_space_file(space.id, sub.id, "deep.txt", "d2", 20, "text/plain", user.id);

    auto entries = db_->list_space_files_recursive(space.id, root.id);
    ASSERT_EQ(entries.size(), 2u);
    EXPECT_EQ(entries[0].relative_path, "Sub/deep.txt");
    EXPECT_EQ(entries[1].relative_path, "top.txt");
}

TEST_F(SpaceFileTest, ListFilesRecursiveEmpty) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "Empty", user.id);

    auto entries = db_->list_space_files_recursive(space.id, folder.id);
    EXPECT_EQ(entries.size(), 0u);
}

TEST_F(SpaceFileTest, ListFilesRecursiveExcludesDeleted) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "Mixed", user.id);
    db_->create_space_file(space.id, folder.id, "keep.txt", "d1", 10, "text/plain", user.id);
    auto del = db_->create_space_file(space.id, folder.id, "gone.txt", "d2", 10, "text/plain", user.id);
    db_->soft_delete_space_file(del.id);

    auto entries = db_->list_space_files_recursive(space.id, folder.id);
    ASSERT_EQ(entries.size(), 1u);
    EXPECT_EQ(entries[0].relative_path, "keep.txt");
}

TEST_F(SpaceFileTest, DeleteOldestVersions) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "big.bin",
                                        "d1", 1000, "application/octet-stream", user.id);
    db_->create_file_version(file.id, "d2", 1000, "application/octet-stream", user.id);
    db_->create_file_version(file.id, "d3", 1000, "application/octet-stream", user.id);

    // Total version storage: 3000 bytes (3 versions x 1000)
    // Delete enough to free at least 1000 bytes
    db_->delete_oldest_file_versions(space.id, 1000);

    auto versions = db_->list_file_versions(file.id);
    // Should have fewer versions now
    EXPECT_LT(versions.size(), 3u);
    // Current version (v3) should still exist
    EXPECT_EQ(versions[0].version_number, 3);
}

// --- Hard Delete ---

TEST_F(SpaceFileTest, HardDeleteSingleFile) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "delete_me.txt",
                                        "disk_hard1", 500, "text/plain", user.id);

    auto disk_ids = db_->hard_delete_space_file(file.id);
    EXPECT_GE(disk_ids.size(), 1u);
    // The disk_file_id we gave should be among those returned
    EXPECT_NE(std::find(disk_ids.begin(), disk_ids.end(), "disk_hard1"), disk_ids.end());

    // File should no longer exist
    auto found = db_->find_space_file(file.id);
    EXPECT_FALSE(found.has_value());
}

TEST_F(SpaceFileTest, HardDeleteFolderRecursive) {
    auto [user, space] = create_user_and_space();
    auto folder = db_->create_space_folder(space.id, "", "ToDelete", user.id);
    auto child = db_->create_space_file(space.id, folder.id, "child.txt",
                                         "disk_child", 100, "text/plain", user.id);

    auto disk_ids = db_->hard_delete_space_file(folder.id);
    // Should include child's disk_file_id
    EXPECT_NE(std::find(disk_ids.begin(), disk_ids.end(), "disk_child"), disk_ids.end());

    // Both folder and child should be gone
    EXPECT_FALSE(db_->find_space_file(folder.id).has_value());
    EXPECT_FALSE(db_->find_space_file(child.id).has_value());
}

TEST_F(SpaceFileTest, HardDeleteFileWithVersions) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "versioned.bin",
                                        "disk_v1", 100, "application/octet-stream", user.id);
    db_->create_file_version(file.id, "disk_v2", 200, "application/octet-stream", user.id);

    auto disk_ids = db_->hard_delete_space_file(file.id);
    // Should include both version disk IDs
    EXPECT_NE(std::find(disk_ids.begin(), disk_ids.end(), "disk_v1"), disk_ids.end());
    EXPECT_NE(std::find(disk_ids.begin(), disk_ids.end(), "disk_v2"), disk_ids.end());

    EXPECT_FALSE(db_->find_space_file(file.id).has_value());
}

// --- Tool Source ---

TEST_F(SpaceFileTest, SetSpaceFileToolSource) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "wiki_attachment.png",
                                        "disk_wiki1", 2048, "image/png", user.id);

    db_->set_space_file_tool_source(file.id, "wiki");

    // The file should still exist and be findable
    auto found = db_->find_space_file(file.id);
    ASSERT_TRUE(found.has_value());

    // Files with non-'files' tool_source are excluded from normal listings
    auto files = db_->list_space_files(space.id, "");
    bool found_in_list = false;
    for (const auto& f : files) {
        if (f.id == file.id) found_in_list = true;
    }
    EXPECT_FALSE(found_in_list);
}

// --- Storage Breakdown ---

TEST_F(SpaceFileTest, GetSpaceStorageBreakdown) {
    auto [user, space] = create_user_and_space();

    // Create files with different tool sources
    auto f1 = db_->create_space_file(space.id, "", "doc.txt",
                                      "disk_br1", 1000, "text/plain", user.id);
    auto f2 = db_->create_space_file(space.id, "", "wiki_img.png",
                                      "disk_br2", 2000, "image/png", user.id);
    db_->set_space_file_tool_source(f2.id, "wiki");
    auto f3 = db_->create_space_file(space.id, "", "task_attach.pdf",
                                      "disk_br3", 3000, "application/pdf", user.id);
    db_->set_space_file_tool_source(f3.id, "tasks");

    auto breakdown = db_->get_space_storage_breakdown(space.id);
    ASSERT_GE(breakdown.size(), 2u);

    // Check that we have tool-type entries
    int64_t total = 0;
    for (const auto& entry : breakdown) {
        if (entry.type == "tool") {
            total += entry.used;
        }
    }
    EXPECT_EQ(total, 6000);
}

TEST_F(SpaceFileTest, GetSpaceStorageBreakdownEmpty) {
    auto [user, space] = create_user_and_space();
    auto breakdown = db_->get_space_storage_breakdown(space.id);
    EXPECT_EQ(breakdown.size(), 0u);
}

// --- Total Personal Spaces Storage ---

TEST_F(SpaceFileTest, GetTotalPersonalSpacesStorageUsed) {
    auto user = db_->create_user("alice", "Alice", "KEY_ALICE");
    auto personal = db_->create_personal_space(user.id, "Alice");

    db_->create_space_file(personal.id, "", "my_file.txt",
                            "disk_p1", 500, "text/plain", user.id);
    db_->create_space_file(personal.id, "", "my_photo.jpg",
                            "disk_p2", 1500, "image/jpeg", user.id);

    int64_t total = db_->get_total_personal_spaces_storage_used();
    EXPECT_EQ(total, 2000);
}

TEST_F(SpaceFileTest, GetTotalPersonalSpacesStorageExcludesRegularSpaces) {
    auto alice = db_->create_user("alice", "Alice", "KEY_ALICE");
    auto personal = db_->create_personal_space(alice.id, "Alice");
    db_->create_space_file(personal.id, "", "personal.txt",
                            "disk_pers", 1000, "text/plain", alice.id);

    // Create a regular (non-personal) space with files
    auto space = db_->create_space("TeamSpace", "desc", true, alice.id, "write");
    db_->create_space_file(space.id, "", "team.txt",
                            "disk_team", 5000, "text/plain", alice.id);

    int64_t total = db_->get_total_personal_spaces_storage_used();
    // Should only include personal space storage
    EXPECT_EQ(total, 1000);
}

// --- Total File Size ---

TEST_F(SpaceFileTest, GetTotalFileSize) {
    auto alice = db_->create_user("alice", "Alice", "KEY_ALICE");
    auto space1 = db_->create_space("Space1", "", true, alice.id, "write");
    db_->create_space_file(space1.id, "", "a.txt",
                            "disk_tot1", 1000, "text/plain", alice.id);

    auto bob = db_->create_user("bob", "Bob", "KEY_BOB", "admin");
    auto space2 = db_->create_space("Space2", "", true, bob.id, "write");
    db_->create_space_file(space2.id, "", "b.txt",
                            "disk_tot2", 2000, "text/plain", bob.id);

    int64_t total = db_->get_total_file_size();
    // Total includes space file versions from both spaces
    EXPECT_GE(total, 3000);
}

TEST_F(SpaceFileTest, GetTotalFileSizeIncludesVersions) {
    auto [user, space] = create_user_and_space();
    auto file = db_->create_space_file(space.id, "", "multi.bin",
                                        "disk_mv1", 1000, "application/octet-stream", user.id);
    db_->create_file_version(file.id, "disk_mv2", 2000, "application/octet-stream", user.id);

    int64_t total = db_->get_total_file_size();
    // Should include both versions (1000 + 2000)
    EXPECT_GE(total, 3000);
}
