#include <gtest/gtest.h>
#include "config.h"
#include "db/database.h"

class AuthCredentialTest : public ::testing::Test {
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
        txn.exec("DELETE FROM wiki_page_permissions");
        txn.exec("DELETE FROM wiki_pages");
        txn.exec("DELETE FROM wiki_permissions");
        txn.exec("DELETE FROM task_board_permissions");
        txn.exec("DELETE FROM calendar_permissions");
        txn.exec("DELETE FROM space_file_versions");
        txn.exec("DELETE FROM space_file_permissions");
        txn.exec("DELETE FROM space_files");
        txn.exec("DELETE FROM mfa_pending_tokens");
        txn.exec("DELETE FROM recovery_keys");
        txn.exec("DELETE FROM recovery_tokens");
        txn.exec("DELETE FROM totp_credentials");
        txn.exec("DELETE FROM password_history");
        txn.exec("DELETE FROM password_credentials");
        txn.exec("DELETE FROM webauthn_challenges");
        txn.exec("DELETE FROM webauthn_credentials");
        txn.exec("DELETE FROM pki_credentials");
        txn.exec("DELETE FROM notifications");
        txn.exec("DELETE FROM reactions");
        txn.exec("DELETE FROM mentions");
        txn.exec("DELETE FROM channel_read_state");
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
        txn.exec("DELETE FROM server_settings");
        txn.commit();
    }

    // Helper: create a user and a personal space, return {user, space}
    struct Setup {
        User user;
        Space space;
    };
    Setup create_user_and_personal_space(const std::string& username = "alice") {
        auto user = db_->create_user(username, username, "KEY_" + username);
        auto space = db_->create_personal_space(user.id, username);
        return {user, space};
    }

    static std::unique_ptr<Database> db_;
    static std::string conn_string_;
};

std::unique_ptr<Database> AuthCredentialTest::db_;
std::string AuthCredentialTest::conn_string_;

// --- Password Credentials ---

TEST_F(AuthCredentialTest, StoreAndVerifyPassword) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    EXPECT_FALSE(db_->has_password(user.id));
    db_->store_password(user.id, "hashed_password_123");
    EXPECT_TRUE(db_->has_password(user.id));
    auto hash = db_->get_password_hash(user.id);
    ASSERT_TRUE(hash.has_value());
    EXPECT_EQ(*hash, "hashed_password_123");
}

TEST_F(AuthCredentialTest, FindUserByUsername) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto found = db_->find_user_by_username("alice");
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->id, user.id);
    EXPECT_FALSE(db_->find_user_by_username("nonexistent").has_value());
}

TEST_F(AuthCredentialTest, DeletePassword) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_password(user.id, "hash");
    EXPECT_TRUE(db_->has_password(user.id));
    db_->delete_password(user.id);
    EXPECT_FALSE(db_->has_password(user.id));
}

TEST_F(AuthCredentialTest, PasswordHistory) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_password(user.id, "current_hash");
    db_->add_password_history(user.id, "old_hash_1");
    db_->add_password_history(user.id, "old_hash_2");
    db_->add_password_history(user.id, "old_hash_3");
    auto history = db_->get_password_history(user.id, 5);
    EXPECT_EQ(history.size(), 3u);
    auto limited = db_->get_password_history(user.id, 2);
    EXPECT_EQ(limited.size(), 2u);
}

TEST_F(AuthCredentialTest, PasswordCreatedAt) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_password(user.id, "hash");
    auto created_at = db_->get_password_created_at(user.id);
    EXPECT_FALSE(created_at.empty());
}

TEST_F(AuthCredentialTest, PasswordNotExpired) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_password(user.id, "hash");
    EXPECT_FALSE(db_->is_password_expired(user.id, 90));
    EXPECT_FALSE(db_->is_password_expired(user.id, 0));
}

// --- TOTP Credentials ---

TEST_F(AuthCredentialTest, StoreAndRetrieveTotpSecret) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    EXPECT_FALSE(db_->has_totp(user.id));
    db_->store_totp_secret(user.id, "JBSWY3DPEHPK3PXP");
    auto unverified = db_->get_unverified_totp_secret(user.id);
    ASSERT_TRUE(unverified.has_value());
    EXPECT_EQ(*unverified, "JBSWY3DPEHPK3PXP");
    EXPECT_FALSE(db_->has_totp(user.id));
    db_->verify_totp(user.id);
    EXPECT_TRUE(db_->has_totp(user.id));
    auto secret = db_->get_totp_secret(user.id);
    ASSERT_TRUE(secret.has_value());
    EXPECT_EQ(*secret, "JBSWY3DPEHPK3PXP");
}

TEST_F(AuthCredentialTest, DeleteTotp) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_totp_secret(user.id, "SECRET");
    db_->verify_totp(user.id);
    EXPECT_TRUE(db_->has_totp(user.id));
    db_->delete_totp(user.id);
    EXPECT_FALSE(db_->has_totp(user.id));
}

// --- WebAuthn Credentials ---

TEST_F(AuthCredentialTest, StoreAndFindWebAuthnCredential) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    std::vector<unsigned char> pubkey = {1, 2, 3, 4, 5};
    db_->store_webauthn_credential(user.id, "cred_id_123", pubkey, 0, "MacBook", "usb,nfc");
    auto found = db_->find_webauthn_credential("cred_id_123");
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->user_id, user.id);
    EXPECT_EQ(found->credential_id, "cred_id_123");
    EXPECT_EQ(found->public_key, pubkey);
    EXPECT_EQ(found->sign_count, 0);
    EXPECT_EQ(found->device_name, "MacBook");
}

TEST_F(AuthCredentialTest, ListWebAuthnCredentials) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_webauthn_credential(user.id, "cred1", {1}, 0, "Device1", "");
    db_->store_webauthn_credential(user.id, "cred2", {2}, 0, "Device2", "");
    auto creds = db_->list_webauthn_credentials(user.id);
    EXPECT_EQ(creds.size(), 2u);
}

TEST_F(AuthCredentialTest, UpdateWebAuthnSignCount) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_webauthn_credential(user.id, "cred1", {1}, 0, "Device", "");
    db_->update_webauthn_sign_count("cred1", 5);
    auto found = db_->find_webauthn_credential("cred1");
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->sign_count, 5);
}

TEST_F(AuthCredentialTest, RemoveWebAuthnCredential) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_webauthn_credential(user.id, "cred1", {1}, 0, "Device1", "");
    db_->store_webauthn_credential(user.id, "cred2", {2}, 0, "Device2", "");
    db_->remove_webauthn_credential("cred1", user.id);
    EXPECT_FALSE(db_->find_webauthn_credential("cred1").has_value());
    EXPECT_TRUE(db_->find_webauthn_credential("cred2").has_value());
}

TEST_F(AuthCredentialTest, CannotRemoveLastWebAuthnCredential) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_webauthn_credential(user.id, "cred1", {1}, 0, "Device", "");
    EXPECT_THROW(db_->remove_webauthn_credential("cred1", user.id), std::runtime_error);
}

TEST_F(AuthCredentialTest, FindUserByCredentialId) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_webauthn_credential(user.id, "cred1", {1}, 0, "Device", "");
    auto found = db_->find_user_by_credential_id("cred1");
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->id, user.id);
    EXPECT_FALSE(db_->find_user_by_credential_id("nonexistent").has_value());
}

// --- WebAuthn Challenges ---

TEST_F(AuthCredentialTest, WebAuthnChallenges) {
    db_->store_webauthn_challenge("challenge_abc", R"({"type":"registration"})");
    auto found = db_->get_webauthn_challenge("challenge_abc");
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->challenge, "challenge_abc");
    EXPECT_EQ(found->extra_data, R"({"type":"registration"})");
    db_->delete_webauthn_challenge("challenge_abc");
    EXPECT_FALSE(db_->get_webauthn_challenge("challenge_abc").has_value());
}

// --- PKI Credentials ---

TEST_F(AuthCredentialTest, StoreAndFindPkiCredential) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_pki_credential(user.id, "SPKI_KEY_DATA", "Laptop");
    auto creds = db_->list_pki_credentials(user.id);
    ASSERT_EQ(creds.size(), 1u);
    EXPECT_EQ(creds[0].public_key, "SPKI_KEY_DATA");
    EXPECT_EQ(creds[0].device_name, "Laptop");
    auto found = db_->find_pki_credential_by_key("SPKI_KEY_DATA");
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->user_id, user.id);
}

TEST_F(AuthCredentialTest, FindUserByPkiKey) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_pki_credential(user.id, "SPKI_KEY", "Device");
    auto found = db_->find_user_by_pki_key("SPKI_KEY");
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->id, user.id);
    EXPECT_FALSE(db_->find_user_by_pki_key("NONEXISTENT").has_value());
}

TEST_F(AuthCredentialTest, RemovePkiCredential) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_pki_credential(user.id, "KEY1", "Device1");
    db_->store_pki_credential(user.id, "KEY2", "Device2");
    auto creds = db_->list_pki_credentials(user.id);
    ASSERT_EQ(creds.size(), 2u);
    db_->remove_pki_credential(creds[0].id, user.id);
    auto remaining = db_->list_pki_credentials(user.id);
    EXPECT_EQ(remaining.size(), 1u);
}

// --- Recovery Keys ---

TEST_F(AuthCredentialTest, StoreAndConsumeRecoveryKeys) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_recovery_keys(user.id, {"hash1", "hash2", "hash3"});
    EXPECT_EQ(db_->count_remaining_recovery_keys(user.id), 3);
    auto consumed = db_->verify_and_consume_recovery_key("hash1");
    ASSERT_TRUE(consumed.has_value());
    EXPECT_EQ(*consumed, user.id);
    EXPECT_EQ(db_->count_remaining_recovery_keys(user.id), 2);
    EXPECT_FALSE(db_->verify_and_consume_recovery_key("hash1").has_value());
    EXPECT_FALSE(db_->verify_and_consume_recovery_key("nonexistent").has_value());
}

TEST_F(AuthCredentialTest, DeleteRecoveryKeys) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->store_recovery_keys(user.id, {"h1", "h2"});
    EXPECT_EQ(db_->count_remaining_recovery_keys(user.id), 2);
    db_->delete_recovery_keys(user.id);
    EXPECT_EQ(db_->count_remaining_recovery_keys(user.id), 0);
}

// --- MFA Pending Tokens ---

TEST_F(AuthCredentialTest, MfaPendingTokens) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto token = db_->create_mfa_pending_token(user.id, "password", 300);
    EXPECT_FALSE(token.empty());
    auto validated = db_->validate_mfa_pending_token(token);
    ASSERT_TRUE(validated.has_value());
    EXPECT_EQ(validated->first, user.id);
    EXPECT_EQ(validated->second, "password");
    db_->delete_mfa_pending_token(token);
    EXPECT_FALSE(db_->validate_mfa_pending_token(token).has_value());
}

TEST_F(AuthCredentialTest, CountUserCredentials) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    EXPECT_EQ(db_->count_user_credentials(user.id), 0);
    db_->store_webauthn_credential(user.id, "cred1", {1}, 0, "Device", "");
    EXPECT_EQ(db_->count_user_credentials(user.id), 1);
    db_->store_pki_credential(user.id, "PKI_KEY", "Laptop");
    EXPECT_EQ(db_->count_user_credentials(user.id), 2);
}

// --- Recovery Tokens (admin-generated) ---

TEST_F(AuthCredentialTest, RecoveryTokens) {
    auto admin = db_->create_user("admin", "Admin", "KEY_ADMIN", "admin");
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto token = db_->create_recovery_token(admin.id, user.id, 24);
    EXPECT_FALSE(token.empty());
    auto user_id = db_->get_recovery_token_user_id(token);
    ASSERT_TRUE(user_id.has_value());
    EXPECT_EQ(*user_id, user.id);
    auto tokens = db_->list_recovery_tokens();
    EXPECT_EQ(tokens.size(), 1u);
    EXPECT_FALSE(tokens[0].used);
    db_->use_recovery_token(token);
    auto tokens_after = db_->list_recovery_tokens();
    EXPECT_TRUE(tokens_after[0].used);
    EXPECT_FALSE(db_->get_recovery_token_user_id(token).has_value());
}

TEST_F(AuthCredentialTest, DeleteRecoveryToken) {
    auto admin = db_->create_user("admin", "Admin", "KEY_ADMIN", "admin");
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_recovery_token(admin.id, user.id, 24);
    auto tokens = db_->list_recovery_tokens();
    ASSERT_EQ(tokens.size(), 1u);
    EXPECT_TRUE(db_->delete_recovery_token(tokens[0].id));
    EXPECT_TRUE(db_->list_recovery_tokens().empty());
}

// --- User Bans ---

TEST_F(AuthCredentialTest, BanAndUnbanUser) {
    auto admin = db_->create_user("admin", "Admin", "KEY_ADMIN", "admin");
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    EXPECT_FALSE(db_->find_user_by_id(user.id)->is_banned);
    db_->ban_user(user.id, admin.id);
    EXPECT_TRUE(db_->find_user_by_id(user.id)->is_banned);
    db_->unban_user(user.id);
    EXPECT_FALSE(db_->find_user_by_id(user.id)->is_banned);
}

// --- Server Settings ---

TEST_F(AuthCredentialTest, ServerSettings) {
    EXPECT_FALSE(db_->get_setting("test_key").has_value());
    db_->set_setting("test_key", "test_value");
    auto val = db_->get_setting("test_key");
    ASSERT_TRUE(val.has_value());
    EXPECT_EQ(*val, "test_value");
    db_->set_setting("test_key", "new_value");
    EXPECT_EQ(*db_->get_setting("test_key"), "new_value");
}

// --- Archive & Lockdown ---

TEST_F(AuthCredentialTest, ServerArchiveState) {
    EXPECT_FALSE(db_->is_server_archived());
    db_->set_server_archived(true);
    EXPECT_TRUE(db_->is_server_archived());
    db_->set_server_archived(false);
    EXPECT_FALSE(db_->is_server_archived());
}

TEST_F(AuthCredentialTest, ServerLockdownState) {
    EXPECT_FALSE(db_->is_server_locked_down());
    db_->set_server_locked_down(true);
    EXPECT_TRUE(db_->is_server_locked_down());
    db_->set_server_locked_down(false);
    EXPECT_FALSE(db_->is_server_locked_down());
}

TEST_F(AuthCredentialTest, ArchiveChannel) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("general", "desc", false, user.id, {user.id});
    EXPECT_FALSE(db_->find_channel_by_id(ch.id)->is_archived);
    db_->archive_channel(ch.id);
    EXPECT_TRUE(db_->find_channel_by_id(ch.id)->is_archived);
    db_->unarchive_channel(ch.id);
    EXPECT_FALSE(db_->find_channel_by_id(ch.id)->is_archived);
}

TEST_F(AuthCredentialTest, ArchiveSpace) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto space = db_->create_space("TestSpace", "desc", true, user.id);
    db_->archive_space(space.id);
    EXPECT_TRUE(db_->find_space_by_id(space.id)->is_archived);
    db_->unarchive_space(space.id);
    EXPECT_FALSE(db_->find_space_by_id(space.id)->is_archived);
}

// --- Role Counting ---

TEST_F(AuthCredentialTest, CountUsersWithRole) {
    db_->create_user("admin1", "Admin1", "K1", "admin");
    db_->create_user("admin2", "Admin2", "K2", "admin");
    db_->create_user("user1", "User1", "K3", "user");
    EXPECT_EQ(db_->count_users_with_role("admin"), 2);
    EXPECT_EQ(db_->count_users_with_role("user"), 1);
}

TEST_F(AuthCredentialTest, CountChannelMembers) {
    auto alice = db_->create_user("alice", "Alice", "KA");
    auto bob = db_->create_user("bob", "Bob", "KB");
    auto carol = db_->create_user("carol", "Carol", "KC");
    auto ch = db_->create_channel("general", "desc", false, alice.id, {alice.id, bob.id, carol.id});
    EXPECT_EQ(db_->count_channel_members(ch.id), 3);
}

// --- Space Invites ---

TEST_F(AuthCredentialTest, SpaceInvites) {
    auto alice = db_->create_user("alice", "Alice", "KA");
    auto bob = db_->create_user("bob", "Bob", "KB");
    auto space = db_->create_space("TestSpace", "desc", false, alice.id);
    auto invite_id = db_->create_space_invite(space.id, bob.id, alice.id, "user");
    EXPECT_FALSE(invite_id.empty());
    EXPECT_TRUE(db_->has_pending_space_invite(space.id, bob.id));
    auto pending = db_->list_pending_space_invites(bob.id);
    ASSERT_EQ(pending.size(), 1u);
    EXPECT_EQ(pending[0].status, "pending");
    db_->update_space_invite_status(invite_id, "accepted");
    EXPECT_FALSE(db_->has_pending_space_invite(space.id, bob.id));
}

// --- Conversations ---

TEST_F(AuthCredentialTest, CreateConversation) {
    auto alice = db_->create_user("alice", "Alice", "KA");
    auto bob = db_->create_user("bob", "Bob", "KB");
    auto carol = db_->create_user("carol", "Carol", "KC");
    auto conv = db_->create_conversation(alice.id, {alice.id, bob.id, carol.id}, "Team Chat");
    EXPECT_FALSE(conv.id.empty());
    EXPECT_EQ(conv.conversation_name, "Team Chat");
    auto convs = db_->list_user_conversations(alice.id);
    EXPECT_EQ(convs.size(), 1u);
}

TEST_F(AuthCredentialTest, RenameConversation) {
    auto alice = db_->create_user("alice", "Alice", "KA");
    auto bob = db_->create_user("bob", "Bob", "KB");
    auto conv = db_->create_conversation(alice.id, {alice.id, bob.id}, "Old Name");
    db_->rename_conversation(conv.id, "New Name");
    auto found = db_->find_channel_by_id(conv.id);
    ASSERT_TRUE(found.has_value());
    EXPECT_EQ(found->conversation_name, "New Name");
}

// --- Space Membership ---

TEST_F(AuthCredentialTest, SpaceMembership) {
    auto alice = db_->create_user("alice", "Alice", "KA");
    auto bob = db_->create_user("bob", "Bob", "KB");
    auto space = db_->create_space("TestSpace", "desc", true, alice.id);
    EXPECT_TRUE(db_->is_space_member(space.id, alice.id));
    EXPECT_FALSE(db_->is_space_member(space.id, bob.id));
    db_->add_space_member(space.id, bob.id, "user");
    EXPECT_TRUE(db_->is_space_member(space.id, bob.id));
    EXPECT_EQ(db_->get_space_member_role(space.id, bob.id), "user");
    db_->update_space_member_role(space.id, bob.id, "admin");
    EXPECT_EQ(db_->get_space_member_role(space.id, bob.id), "admin");
    auto members = db_->get_space_members_with_roles(space.id);
    EXPECT_EQ(members.size(), 2u);
    db_->remove_space_member(space.id, bob.id);
    EXPECT_FALSE(db_->is_space_member(space.id, bob.id));
}

// --- Search ---

TEST_F(AuthCredentialTest, SearchUsers) {
    db_->create_user("alice", "Alice Smith", "KA");
    db_->create_user("bob", "Bob Jones", "KB");
    db_->create_user("alicia", "Alicia Keys", "KC");
    auto results = db_->search_users("ali", 10, 0);
    EXPECT_EQ(results.size(), 2u);
    auto results2 = db_->search_users("bob", 10, 0);
    EXPECT_EQ(results2.size(), 1u);
}

TEST_F(AuthCredentialTest, SearchChannels) {
    auto user = db_->create_user("alice", "Alice", "KA");
    auto space = db_->create_space("TestSpace", "desc", true, user.id);
    db_->create_channel("general", "General chat", false, user.id, {user.id}, true, "write", space.id);
    db_->create_channel("random", "Random stuff", false, user.id, {user.id}, true, "write", space.id);
    auto results = db_->search_channels("general", user.id, false, 10, 0);
    EXPECT_EQ(results.size(), 1u);
}

TEST_F(AuthCredentialTest, SearchSpaces) {
    auto user = db_->create_user("alice", "Alice", "KA");
    db_->create_space("Engineering", "eng team", true, user.id);
    db_->create_space("Marketing", "mkt team", true, user.id);
    auto results = db_->search_spaces("eng", user.id, false, 10, 0);
    EXPECT_EQ(results.size(), 1u);
}

// --- Join Requests ---

TEST_F(AuthCredentialTest, JoinRequestFlow) {
    auto admin = db_->create_user("admin", "Admin", "KA", "admin");
    auto req_id = db_->create_join_request("newuser", "New User", "NEW_KEY", "pki", "");
    EXPECT_FALSE(req_id.empty());
    auto pending = db_->list_pending_requests();
    ASSERT_EQ(pending.size(), 1u);
    EXPECT_FALSE(db_->has_approved_join_request("newuser"));
    db_->update_join_request(req_id, "approved", admin.id);
    EXPECT_TRUE(db_->has_approved_join_request("newuser"));
    EXPECT_TRUE(db_->list_pending_requests().empty());
}

// --- User Online/Offline ---

TEST_F(AuthCredentialTest, UserOnlineStatus) {
    auto user = db_->create_user("alice", "Alice", "KA");
    EXPECT_FALSE(db_->find_user_by_id(user.id)->is_online);
    db_->set_user_online(user.id, true);
    EXPECT_TRUE(db_->find_user_by_id(user.id)->is_online);
    db_->set_user_online(user.id, false);
    EXPECT_FALSE(db_->find_user_by_id(user.id)->is_online);
    EXPECT_FALSE(db_->find_user_by_id(user.id)->last_seen.empty());
}

TEST_F(AuthCredentialTest, SetAllUsersOffline) {
    auto a = db_->create_user("alice", "Alice", "KA");
    auto b = db_->create_user("bob", "Bob", "KB");
    db_->set_user_online(a.id, true);
    db_->set_user_online(b.id, true);
    db_->set_all_users_offline();
    EXPECT_FALSE(db_->find_user_by_id(a.id)->is_online);
    EXPECT_FALSE(db_->find_user_by_id(b.id)->is_online);
}

// --- Space Tools ---

TEST_F(AuthCredentialTest, SpaceTools) {
    auto user = db_->create_user("alice", "Alice", "KA");
    auto space = db_->create_space("TestSpace", "desc", true, user.id);
    db_->enable_space_tool(space.id, "wiki", user.id);
    db_->enable_space_tool(space.id, "calendar", user.id);
    EXPECT_TRUE(db_->is_space_tool_enabled(space.id, "wiki"));
    EXPECT_TRUE(db_->is_space_tool_enabled(space.id, "calendar"));
    EXPECT_FALSE(db_->is_space_tool_enabled(space.id, "tasks"));
    auto tools = db_->get_space_tools(space.id);
    EXPECT_EQ(tools.size(), 2u);
    db_->disable_space_tool(space.id, "wiki");
    EXPECT_FALSE(db_->is_space_tool_enabled(space.id, "wiki"));
}

// --- Default Join Channels ---

TEST_F(AuthCredentialTest, DefaultJoinChannels) {
    auto user = db_->create_user("alice", "Alice", "KA");
    auto space = db_->create_space("TestSpace", "desc", true, user.id);
    db_->create_channel("welcome", "Welcome", false, user.id, {user.id}, true, "write", space.id, true);
    db_->create_channel("general", "General", false, user.id, {user.id}, true, "write", space.id, false);
    auto defaults = db_->get_default_join_channels(space.id);
    ASSERT_EQ(defaults.size(), 1u);
    EXPECT_EQ(defaults[0].name, "welcome");
}

// --- has_resource_permission_in_space ---

TEST_F(AuthCredentialTest, HasResourcePermissionFiles) {
    auto [owner, space] = create_user_and_personal_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");

    // Bob has no permissions yet
    EXPECT_FALSE(db_->has_resource_permission_in_space(space.id, bob.id, "files"));

    // Create a file and grant Bob permission
    auto file = db_->create_space_file(space.id, "", "shared.txt",
                                        "disk1", 100, "text/plain", owner.id);
    db_->set_file_permission(file.id, bob.id, "view", owner.id);

    EXPECT_TRUE(db_->has_resource_permission_in_space(space.id, bob.id, "files"));
}

TEST_F(AuthCredentialTest, HasResourcePermissionCalendar) {
    auto [owner, space] = create_user_and_personal_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");

    EXPECT_FALSE(db_->has_resource_permission_in_space(space.id, bob.id, "calendar"));

    db_->set_calendar_permission(space.id, bob.id, "view", owner.id);

    EXPECT_TRUE(db_->has_resource_permission_in_space(space.id, bob.id, "calendar"));
}

TEST_F(AuthCredentialTest, HasResourcePermissionTasks) {
    auto [owner, space] = create_user_and_personal_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");

    EXPECT_FALSE(db_->has_resource_permission_in_space(space.id, bob.id, "tasks"));

    db_->set_task_permission(space.id, bob.id, "edit", owner.id);

    EXPECT_TRUE(db_->has_resource_permission_in_space(space.id, bob.id, "tasks"));
}

TEST_F(AuthCredentialTest, HasResourcePermissionWiki) {
    auto [owner, space] = create_user_and_personal_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");

    EXPECT_FALSE(db_->has_resource_permission_in_space(space.id, bob.id, "wiki"));

    db_->set_wiki_permission(space.id, bob.id, "view", owner.id);

    EXPECT_TRUE(db_->has_resource_permission_in_space(space.id, bob.id, "wiki"));
}

// --- list_shared_with_user ---

TEST_F(AuthCredentialTest, ListSharedWithUserEmpty) {
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");
    auto shared = db_->list_shared_with_user(bob.id);
    EXPECT_EQ(shared.size(), 0u);
}

TEST_F(AuthCredentialTest, ListSharedWithUserFiles) {
    auto [owner, space] = create_user_and_personal_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");

    auto file = db_->create_space_file(space.id, "", "shared_doc.txt",
                                        "disk_sh1", 200, "text/plain", owner.id);
    db_->set_file_permission(file.id, bob.id, "edit", owner.id);

    auto shared = db_->list_shared_with_user(bob.id);
    ASSERT_EQ(shared.size(), 1u);
    EXPECT_EQ(shared[0].name, "shared_doc.txt");
    EXPECT_EQ(shared[0].resource_type, "file");
    EXPECT_EQ(shared[0].permission, "edit");
    EXPECT_EQ(shared[0].owner_username, "alice");
}

TEST_F(AuthCredentialTest, ListSharedWithUserCalendar) {
    auto [owner, space] = create_user_and_personal_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");

    db_->set_calendar_permission(space.id, bob.id, "view", owner.id);

    auto shared = db_->list_shared_with_user(bob.id);
    ASSERT_EQ(shared.size(), 1u);
    EXPECT_EQ(shared[0].resource_type, "calendar");
    EXPECT_EQ(shared[0].permission, "view");
}

TEST_F(AuthCredentialTest, ListSharedWithUserMultipleTypes) {
    auto [owner, space] = create_user_and_personal_space("alice");
    auto bob = db_->create_user("bob", "Bob", "KEY_BOB");

    // Share a file
    auto file = db_->create_space_file(space.id, "", "doc.txt",
                                        "disk_multi", 100, "text/plain", owner.id);
    db_->set_file_permission(file.id, bob.id, "view", owner.id);

    // Share calendar
    db_->set_calendar_permission(space.id, bob.id, "edit", owner.id);

    // Share tasks
    db_->set_task_permission(space.id, bob.id, "view", owner.id);

    auto shared = db_->list_shared_with_user(bob.id);
    EXPECT_GE(shared.size(), 3u);
}

TEST_F(AuthCredentialTest, ListSharedExcludesOwnResources) {
    auto [owner, space] = create_user_and_personal_space("alice");

    // Owner's own file permission (auto-granted) should NOT appear
    auto file = db_->create_space_file(space.id, "", "my_file.txt",
                                        "disk_own", 100, "text/plain", owner.id);

    auto shared = db_->list_shared_with_user(owner.id);
    // Owner's own resources are excluded (personal_owner_id != user_id)
    EXPECT_EQ(shared.size(), 0u);
}

// --- cleanup_expired_mfa_tokens ---

TEST_F(AuthCredentialTest, CleanupExpiredMfaTokensDoesNotCrash) {
    // Simply verify the method runs without error on an empty table
    EXPECT_NO_THROW(db_->cleanup_expired_mfa_tokens());
}

TEST_F(AuthCredentialTest, CleanupExpiredMfaTokensRemovesExpired) {
    auto user = db_->create_user("alice", "Alice", "KEY_ALICE");

    // Create a token with a very short expiry (1 second)
    auto token = db_->create_mfa_pending_token(user.id, "totp", 1);
    EXPECT_FALSE(token.empty());

    // Token should be valid right now
    auto validated = db_->validate_mfa_pending_token(token);
    ASSERT_TRUE(validated.has_value());

    // Force the token to expire by updating its expires_at in the past
    {
        pqxx::connection conn(conn_string_);
        pqxx::work txn(conn);
        txn.exec_params(
            "UPDATE mfa_pending_tokens SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1",
            token);
        txn.commit();
    }

    // Now cleanup should remove it
    db_->cleanup_expired_mfa_tokens();

    // Token should no longer validate
    auto after = db_->validate_mfa_pending_token(token);
    EXPECT_FALSE(after.has_value());
}
// --- Composite Search: Messages ---

TEST_F(AuthCredentialTest, SearchCompositeMessagesEmptyFilters) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("general", "", false, user.id, {user.id});
    db_->create_message(ch.id, user.id, "hello world");

    std::vector<Database::CompositeFilter> filters;
    auto results = db_->search_composite_messages(filters, "and", user.id, false, 50, 0);
    // Empty filters => no extra clauses, returns all non-deleted messages visible to user
    EXPECT_GE(results.size(), 1u);
    EXPECT_EQ(results[0].content, "hello world");
}

TEST_F(AuthCredentialTest, SearchCompositeMessagesNoMatch) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("general", "", false, user.id, {user.id});
    db_->create_message(ch.id, user.id, "hello world");

    std::vector<Database::CompositeFilter> filters{{"messages", "zzzznonexistent"}};
    auto results = db_->search_composite_messages(filters, "and", user.id, false, 50, 0);
    EXPECT_TRUE(results.empty());
}

TEST_F(AuthCredentialTest, SearchCompositeMessagesByContent) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("general", "", false, user.id, {user.id});
    db_->create_message(ch.id, user.id, "the quick brown fox jumps over the lazy dog");
    db_->create_message(ch.id, user.id, "unrelated text about cats");

    std::vector<Database::CompositeFilter> filters{{"messages", "fox"}};
    auto results = db_->search_composite_messages(filters, "and", user.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_NE(results[0].content.find("fox"), std::string::npos);
}

TEST_F(AuthCredentialTest, SearchCompositeMessagesByUser) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    auto ch = db_->create_channel("general", "", false, alice.id, {alice.id, bob.id});
    db_->create_message(ch.id, alice.id, "message from alice");
    db_->create_message(ch.id, bob.id, "message from bob");

    std::vector<Database::CompositeFilter> filters{{"users", "bob"}};
    auto results = db_->search_composite_messages(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].username, "bob");
}

TEST_F(AuthCredentialTest, SearchCompositeMessagesByChannel) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch1 = db_->create_channel("general", "", false, user.id, {user.id});
    auto ch2 = db_->create_channel("random", "", false, user.id, {user.id});
    db_->create_message(ch1.id, user.id, "in general");
    db_->create_message(ch2.id, user.id, "in random");

    std::vector<Database::CompositeFilter> filters{{"channels", "random"}};
    auto results = db_->search_composite_messages(filters, "and", user.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].channel_name, "random");
}

TEST_F(AuthCredentialTest, SearchCompositeMessagesAndMode) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    auto ch = db_->create_channel("general", "", false, alice.id, {alice.id, bob.id});
    db_->create_message(ch.id, alice.id, "the quick brown fox");
    db_->create_message(ch.id, bob.id, "the quick brown dog");

    // AND mode: must match both filters
    std::vector<Database::CompositeFilter> filters{{"messages", "fox"}, {"users", "alice"}};
    auto results = db_->search_composite_messages(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].username, "alice");
}

TEST_F(AuthCredentialTest, SearchCompositeMessagesOrMode) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    auto ch1 = db_->create_channel("general", "", false, alice.id, {alice.id, bob.id});
    auto ch2 = db_->create_channel("random", "", false, alice.id, {alice.id});
    db_->create_message(ch1.id, bob.id, "hello from bob");
    db_->create_message(ch2.id, alice.id, "hello from alice in random");

    // OR mode: match either filter
    std::vector<Database::CompositeFilter> filters{{"users", "bob"}, {"channels", "random"}};
    auto results = db_->search_composite_messages(filters, "or", alice.id, false, 50, 0);
    EXPECT_GE(results.size(), 2u);
}

TEST_F(AuthCredentialTest, SearchCompositeMessagesAdminAccess) {
    auto admin = db_->create_user("admin", "Admin", "KEY_ADMIN", "admin");
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("secret", "", false, user.id, {user.id});
    db_->create_message(ch.id, user.id, "secret information about technology");

    // Admin can see non-direct channel messages even without membership
    std::vector<Database::CompositeFilter> filters{{"messages", "technology"}};
    auto results = db_->search_composite_messages(filters, "and", admin.id, true, 50, 0);
    EXPECT_EQ(results.size(), 1u);
}

TEST_F(AuthCredentialTest, SearchCompositeMessagesLimitOffset) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("general", "", false, user.id, {user.id});
    for (int i = 0; i < 5; i++) {
        db_->create_message(ch.id, user.id, "message number " + std::to_string(i));
    }

    std::vector<Database::CompositeFilter> filters;
    auto page1 = db_->search_composite_messages(filters, "and", user.id, false, 2, 0);
    EXPECT_EQ(page1.size(), 2u);

    auto page2 = db_->search_composite_messages(filters, "and", user.id, false, 2, 2);
    EXPECT_EQ(page2.size(), 2u);

    auto page3 = db_->search_composite_messages(filters, "and", user.id, false, 2, 4);
    EXPECT_EQ(page3.size(), 1u);
}

// --- Composite Search: Files ---

TEST_F(AuthCredentialTest, SearchCompositeFilesEmptyFilters) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("general", "", false, user.id, {user.id});
    db_->create_file_message(ch.id, user.id, "", "file-001", "report.pdf", 1024, "application/pdf");

    std::vector<Database::CompositeFilter> filters;
    auto results = db_->search_composite_files(filters, "and", user.id, false, 50, 0);
    EXPECT_GE(results.size(), 1u);
    EXPECT_EQ(results[0].file_name, "report.pdf");
}

TEST_F(AuthCredentialTest, SearchCompositeFilesNoMatch) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("general", "", false, user.id, {user.id});
    db_->create_file_message(ch.id, user.id, "", "file-001", "report.pdf", 1024, "application/pdf");

    std::vector<Database::CompositeFilter> filters{{"files", "zzzznonexistent"}};
    auto results = db_->search_composite_files(filters, "and", user.id, false, 50, 0);
    EXPECT_TRUE(results.empty());
}

TEST_F(AuthCredentialTest, SearchCompositeFilesByFileName) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("general", "", false, user.id, {user.id});
    db_->create_file_message(ch.id, user.id, "", "file-001", "report.pdf", 1024, "application/pdf");
    db_->create_file_message(ch.id, user.id, "", "file-002", "photo.jpg", 2048, "image/jpeg");

    std::vector<Database::CompositeFilter> filters{{"files", "report"}};
    auto results = db_->search_composite_files(filters, "and", user.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].file_name, "report.pdf");
}

TEST_F(AuthCredentialTest, SearchCompositeFilesByUser) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    auto ch = db_->create_channel("general", "", false, alice.id, {alice.id, bob.id});
    db_->create_file_message(ch.id, alice.id, "", "file-001", "alice_doc.pdf", 1024, "application/pdf");
    db_->create_file_message(ch.id, bob.id, "", "file-002", "bob_doc.pdf", 2048, "application/pdf");

    std::vector<Database::CompositeFilter> filters{{"users", "bob"}};
    auto results = db_->search_composite_files(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].username, "bob");
}

TEST_F(AuthCredentialTest, SearchCompositeFilesAdminAccess) {
    auto admin = db_->create_user("admin", "Admin", "KEY_ADMIN", "admin");
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto ch = db_->create_channel("secret", "", false, user.id, {user.id});
    db_->create_file_message(ch.id, user.id, "", "file-001", "secret.pdf", 512, "application/pdf");

    std::vector<Database::CompositeFilter> filters{{"files", "secret"}};
    auto results = db_->search_composite_files(filters, "and", admin.id, true, 50, 0);
    EXPECT_EQ(results.size(), 1u);
}

// --- Composite Search: Users ---

TEST_F(AuthCredentialTest, SearchCompositeUsersEmptyFilters) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_user("bob", "Bob", "KEY_B");

    std::vector<Database::CompositeFilter> filters;
    auto results = db_->search_composite_users(filters, "and", alice.id, false, 50, 0);
    // No filters => all users
    EXPECT_GE(results.size(), 2u);
}

TEST_F(AuthCredentialTest, SearchCompositeUsersNoMatch) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");

    std::vector<Database::CompositeFilter> filters{{"users", "zzzznonexistent"}};
    auto results = db_->search_composite_users(filters, "and", alice.id, false, 50, 0);
    EXPECT_TRUE(results.empty());
}

TEST_F(AuthCredentialTest, SearchCompositeUsersByUsername) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_user("bob", "Bob", "KEY_B");
    db_->create_user("charlie", "Charlie", "KEY_C");

    std::vector<Database::CompositeFilter> filters{{"users", "bob"}};
    auto results = db_->search_composite_users(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].username, "bob");
}

TEST_F(AuthCredentialTest, SearchCompositeUsersByChannel) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    db_->create_user("charlie", "Charlie", "KEY_C");
    db_->create_channel("devteam", "", false, alice.id, {alice.id, bob.id});

    std::vector<Database::CompositeFilter> filters{{"channels", "devteam"}};
    auto results = db_->search_composite_users(filters, "and", alice.id, false, 50, 0);
    EXPECT_EQ(results.size(), 2u);
    // charlie should not be in results
    for (const auto& u : results) {
        EXPECT_NE(u.username, "charlie");
    }
}

TEST_F(AuthCredentialTest, SearchCompositeUsersBySpace) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    db_->create_user("charlie", "Charlie", "KEY_C");
    auto space = db_->create_space("Engineering", "Eng team", true, alice.id);
    db_->add_space_member(space.id, bob.id, "user");

    std::vector<Database::CompositeFilter> filters{{"spaces", "Engineering"}};
    auto results = db_->search_composite_users(filters, "and", alice.id, false, 50, 0);
    EXPECT_EQ(results.size(), 2u);
    for (const auto& u : results) {
        EXPECT_NE(u.username, "charlie");
    }
}

TEST_F(AuthCredentialTest, SearchCompositeUsersAndMode) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    auto charlie = db_->create_user("charlie", "Charlie", "KEY_C");
    db_->create_channel("devteam", "", false, alice.id, {alice.id, bob.id, charlie.id});

    // AND mode: must match both name and channel
    std::vector<Database::CompositeFilter> filters{{"users", "bob"}, {"channels", "devteam"}};
    auto results = db_->search_composite_users(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].username, "bob");
}

TEST_F(AuthCredentialTest, SearchCompositeUsersOrMode) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    db_->create_user("charlie", "Charlie", "KEY_C");
    db_->create_channel("devteam", "", false, alice.id, {alice.id, bob.id});

    // OR mode: name match OR channel match — should return at least 2
    // (charlie by name, plus members of devteam)
    std::vector<Database::CompositeFilter> filters{{"users", "charlie"}, {"channels", "devteam"}};
    auto results = db_->search_composite_users(filters, "or", alice.id, false, 50, 0);
    EXPECT_GE(results.size(), 2u);
}

TEST_F(AuthCredentialTest, SearchCompositeUsersLimitOffset) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_user("bob", "Bob", "KEY_B");
    db_->create_user("charlie", "Charlie", "KEY_C");
    db_->create_user("dave", "Dave", "KEY_D");

    std::vector<Database::CompositeFilter> filters;
    auto page1 = db_->search_composite_users(filters, "and", alice.id, false, 2, 0);
    EXPECT_EQ(page1.size(), 2u);

    auto page2 = db_->search_composite_users(filters, "and", alice.id, false, 2, 2);
    EXPECT_EQ(page2.size(), 2u);

    // Verify different users on different pages
    EXPECT_NE(page1[0].username, page2[0].username);
}

// --- Composite Search: Channels ---

TEST_F(AuthCredentialTest, SearchCompositeChannelsEmptyFilters) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_channel("general", "Main channel", false, user.id, {user.id});

    std::vector<Database::CompositeFilter> filters;
    auto results = db_->search_composite_channels(filters, "and", user.id, false, 50, 0);
    EXPECT_GE(results.size(), 1u);
    EXPECT_EQ(results[0].name, "general");
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsNoMatch) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_channel("general", "", false, user.id, {user.id});

    std::vector<Database::CompositeFilter> filters{{"channels", "zzzznonexistent"}};
    auto results = db_->search_composite_channels(filters, "and", user.id, false, 50, 0);
    EXPECT_TRUE(results.empty());
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsByName) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_channel("general", "", false, user.id, {user.id});
    db_->create_channel("random", "", false, user.id, {user.id});
    db_->create_channel("dev-ops", "", false, user.id, {user.id});

    std::vector<Database::CompositeFilter> filters{{"channels", "random"}};
    auto results = db_->search_composite_channels(filters, "and", user.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "random");
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsByUser) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    db_->create_channel("alice-only", "", false, alice.id, {alice.id});
    db_->create_channel("shared", "", false, alice.id, {alice.id, bob.id});

    std::vector<Database::CompositeFilter> filters{{"users", "bob"}};
    auto results = db_->search_composite_channels(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "shared");
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsBySpace) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto space = db_->create_space("Engineering", "Eng team", true, user.id);
    db_->create_channel("eng-general", "", false, user.id, {user.id}, true, "write", space.id);
    db_->create_channel("unrelated", "", false, user.id, {user.id});

    std::vector<Database::CompositeFilter> filters{{"spaces", "Engineering"}};
    auto results = db_->search_composite_channels(filters, "and", user.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "eng-general");
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsAndMode) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    db_->create_channel("general", "", false, alice.id, {alice.id, bob.id});
    db_->create_channel("random", "", false, alice.id, {alice.id});

    // AND: channel name matches AND has bob as member
    std::vector<Database::CompositeFilter> filters{{"channels", "general"}, {"users", "bob"}};
    auto results = db_->search_composite_channels(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "general");
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsOrMode) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    db_->create_channel("general", "", false, alice.id, {alice.id});
    db_->create_channel("random", "", false, alice.id, {alice.id, bob.id});

    // OR: channel name matches OR has bob as member
    std::vector<Database::CompositeFilter> filters{{"channels", "general"}, {"users", "bob"}};
    auto results = db_->search_composite_channels(filters, "or", alice.id, false, 50, 0);
    EXPECT_GE(results.size(), 2u);
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsAdminAccess) {
    auto admin = db_->create_user("admin", "Admin", "KEY_ADMIN", "admin");
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_channel("secret", "", false, user.id, {user.id});

    // Admin can see all non-direct channels
    std::vector<Database::CompositeFilter> filters{{"channels", "secret"}};
    auto results = db_->search_composite_channels(filters, "and", admin.id, true, 50, 0);
    EXPECT_EQ(results.size(), 1u);
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsExcludesDirect) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    db_->create_channel("general", "", false, alice.id, {alice.id});
    db_->create_channel("dm", "", true, alice.id, {alice.id, bob.id}, false);

    std::vector<Database::CompositeFilter> filters;
    auto results = db_->search_composite_channels(filters, "and", alice.id, false, 50, 0);
    // Only non-direct channels should appear
    for (const auto& r : results) {
        EXPECT_NE(r.name, "dm");
    }
}

TEST_F(AuthCredentialTest, SearchCompositeChannelsLimitOffset) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_channel("alpha", "", false, user.id, {user.id});
    db_->create_channel("beta", "", false, user.id, {user.id});
    db_->create_channel("gamma", "", false, user.id, {user.id});

    std::vector<Database::CompositeFilter> filters;
    auto page1 = db_->search_composite_channels(filters, "and", user.id, false, 2, 0);
    EXPECT_EQ(page1.size(), 2u);

    auto page2 = db_->search_composite_channels(filters, "and", user.id, false, 2, 2);
    EXPECT_EQ(page2.size(), 1u);
}

// --- Composite Search: Spaces ---

TEST_F(AuthCredentialTest, SearchCompositeSpacesEmptyFilters) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_space("Engineering", "Eng team", true, user.id);

    std::vector<Database::CompositeFilter> filters;
    auto results = db_->search_composite_spaces(filters, "and", user.id, false, 50, 0);
    EXPECT_GE(results.size(), 1u);
    EXPECT_EQ(results[0].name, "Engineering");
}

TEST_F(AuthCredentialTest, SearchCompositeSpacesNoMatch) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_space("Engineering", "", true, user.id);

    std::vector<Database::CompositeFilter> filters{{"spaces", "zzzznonexistent"}};
    auto results = db_->search_composite_spaces(filters, "and", user.id, false, 50, 0);
    EXPECT_TRUE(results.empty());
}

TEST_F(AuthCredentialTest, SearchCompositeSpacesByName) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_space("Engineering", "Eng team", true, user.id);
    db_->create_space("Marketing", "Mkt team", true, user.id);

    std::vector<Database::CompositeFilter> filters{{"spaces", "Marketing"}};
    auto results = db_->search_composite_spaces(filters, "and", user.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "Marketing");
}

TEST_F(AuthCredentialTest, SearchCompositeSpacesByUser) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    db_->create_space("AliceSpace", "", true, alice.id);
    auto shared = db_->create_space("SharedSpace", "", true, alice.id);
    db_->add_space_member(shared.id, bob.id, "user");

    std::vector<Database::CompositeFilter> filters{{"users", "bob"}};
    auto results = db_->search_composite_spaces(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "SharedSpace");
}

TEST_F(AuthCredentialTest, SearchCompositeSpacesByChannel) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    auto space = db_->create_space("Engineering", "", true, user.id);
    db_->create_channel("eng-general", "", false, user.id, {user.id}, true, "write", space.id);
    db_->create_space("Marketing", "", true, user.id);

    std::vector<Database::CompositeFilter> filters{{"channels", "eng-general"}};
    auto results = db_->search_composite_spaces(filters, "and", user.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "Engineering");
}

TEST_F(AuthCredentialTest, SearchCompositeSpacesAndMode) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    auto eng = db_->create_space("Engineering", "", true, alice.id);
    db_->create_space("Marketing", "", true, alice.id);
    db_->add_space_member(eng.id, bob.id, "user");

    // AND: space name AND user member
    std::vector<Database::CompositeFilter> filters{{"spaces", "Engineering"}, {"users", "bob"}};
    auto results = db_->search_composite_spaces(filters, "and", alice.id, false, 50, 0);
    ASSERT_EQ(results.size(), 1u);
    EXPECT_EQ(results[0].name, "Engineering");
}

TEST_F(AuthCredentialTest, SearchCompositeSpacesOrMode) {
    auto alice = db_->create_user("alice", "Alice", "KEY_A");
    auto bob = db_->create_user("bob", "Bob", "KEY_B");
    auto eng = db_->create_space("Engineering", "", true, alice.id);
    db_->create_space("Marketing", "", true, alice.id);
    db_->add_space_member(eng.id, bob.id, "user");

    // OR: space name OR user member
    std::vector<Database::CompositeFilter> filters{{"spaces", "Marketing"}, {"users", "bob"}};
    auto results = db_->search_composite_spaces(filters, "or", alice.id, false, 50, 0);
    EXPECT_GE(results.size(), 2u);
}

TEST_F(AuthCredentialTest, SearchCompositeSpacesAdminAccess) {
    auto admin = db_->create_user("admin", "Admin", "KEY_ADMIN", "admin");
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_space("SecretSpace", "", false, user.id);

    // Admin can see all spaces
    std::vector<Database::CompositeFilter> filters{{"spaces", "SecretSpace"}};
    auto results = db_->search_composite_spaces(filters, "and", admin.id, true, 50, 0);
    EXPECT_EQ(results.size(), 1u);
}

TEST_F(AuthCredentialTest, SearchCompositeSpacesLimitOffset) {
    auto user = db_->create_user("alice", "Alice", "KEY_A");
    db_->create_space("Alpha", "", true, user.id);
    db_->create_space("Beta", "", true, user.id);
    db_->create_space("Gamma", "", true, user.id);

    std::vector<Database::CompositeFilter> filters;
    auto page1 = db_->search_composite_spaces(filters, "and", user.id, false, 2, 0);
    EXPECT_EQ(page1.size(), 2u);

    auto page2 = db_->search_composite_spaces(filters, "and", user.id, false, 2, 2);
    EXPECT_EQ(page2.size(), 1u);
}
