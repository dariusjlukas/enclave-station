"""Tests for admin endpoints: invites, join requests, settings, roles."""

import pytest
from conftest import PKIIdentity, auth_header, pki_register


class TestAdminInvites:
    def test_create_invite(self, client, admin_user):
        r = client.post("/api/admin/invites", json={"expiry_hours": 1},
                        headers=admin_user["headers"])
        assert r.status_code == 200
        assert "token" in r.json()

    def test_list_invites(self, client, admin_user):
        client.post("/api/admin/invites", json={},
                    headers=admin_user["headers"])
        r = client.get("/api/admin/invites", headers=admin_user["headers"])
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_non_admin_cannot_create_invite(self, client, admin_user, regular_user):
        r = client.post("/api/admin/invites", json={},
                        headers=regular_user["headers"])
        assert r.status_code == 403

    def test_register_with_invite_token(self, client, admin_user):
        # Set registration mode to invite-only
        client.put("/api/admin/settings", json={
            "registration_mode": "invite",
        }, headers=admin_user["headers"])
        # Create invite
        r = client.post("/api/admin/invites", json={},
                        headers=admin_user["headers"])
        token = r.json()["token"]
        # Register with invite
        data = pki_register(client, "invited", "Invited User", token=token)
        assert data["user"]["username"] == "invited"

    def test_revoke_invite(self, client, admin_user):
        r = client.post("/api/admin/invites", json={},
                        headers=admin_user["headers"])
        token_val = r.json()["token"]
        # Get invite id
        r = client.get("/api/admin/invites", headers=admin_user["headers"])
        invite = next(i for i in r.json() if i["token"] == token_val)
        # Revoke it
        r = client.delete(f"/api/admin/invites/{invite['id']}",
                          headers=admin_user["headers"])
        assert r.status_code == 200
        # Should no longer appear as active
        r = client.get("/api/admin/invites", headers=admin_user["headers"])
        remaining_ids = [i["id"] for i in r.json()]
        assert invite["id"] not in remaining_ids

    def test_revoke_used_invite_fails(self, client, admin_user):
        # Set to invite mode and create an invite
        client.put("/api/admin/settings", json={
            "registration_mode": "invite",
        }, headers=admin_user["headers"])
        r = client.post("/api/admin/invites", json={},
                        headers=admin_user["headers"])
        token_val = r.json()["token"]
        # Use it by registering
        pki_register(client, "invitee", "Invitee", token=token_val)
        # Get the invite id
        r = client.get("/api/admin/invites", headers=admin_user["headers"])
        invite = next(i for i in r.json() if i["token"] == token_val)
        assert invite["used"] is True
        # Revoking a used invite should fail
        r = client.delete(f"/api/admin/invites/{invite['id']}",
                          headers=admin_user["headers"])
        assert r.status_code == 404

    def test_revoke_nonexistent_invite_returns_404(self, client, admin_user):
        r = client.delete("/api/admin/invites/00000000-0000-0000-0000-000000000000",
                          headers=admin_user["headers"])
        assert r.status_code == 404

    def test_non_admin_cannot_revoke_invite(self, client, admin_user, regular_user):
        r = client.post("/api/admin/invites", json={},
                        headers=admin_user["headers"])
        r2 = client.get("/api/admin/invites", headers=admin_user["headers"])
        invite_id = r2.json()[0]["id"]
        r = client.delete(f"/api/admin/invites/{invite_id}",
                          headers=regular_user["headers"])
        assert r.status_code == 403

    def test_register_with_revoked_invite_rejected(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "registration_mode": "invite",
        }, headers=admin_user["headers"])
        # Create and revoke an invite
        r = client.post("/api/admin/invites", json={},
                        headers=admin_user["headers"])
        token_val = r.json()["token"]
        r = client.get("/api/admin/invites", headers=admin_user["headers"])
        invite = next(i for i in r.json() if i["token"] == token_val)
        client.delete(f"/api/admin/invites/{invite['id']}",
                      headers=admin_user["headers"])
        # Try to register with the revoked token
        identity = PKIIdentity()
        r = client.post("/api/auth/pki/challenge", json={})
        challenge = r.json()["challenge"]
        r = client.post("/api/auth/pki/register", json={
            "username": "blocked",
            "display_name": "Blocked",
            "public_key": identity.public_key_b64url,
            "challenge": challenge,
            "signature": identity.sign(challenge),
            "invite_token": token_val,
        })
        assert r.status_code == 403

    def test_register_without_invite_rejected(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "registration_mode": "invite",
        }, headers=admin_user["headers"])
        identity = PKIIdentity()
        r = client.post("/api/auth/pki/challenge", json={})
        challenge = r.json()["challenge"]
        r = client.post("/api/auth/pki/register", json={
            "username": "sneaky",
            "display_name": "Sneaky",
            "public_key": identity.public_key_b64url,
            "challenge": challenge,
            "signature": identity.sign(challenge),
        })
        assert r.status_code == 403

    def test_invite_only_register_with_token(self, client, admin_user):
        """In invite_only mode, registration with a valid token succeeds."""
        client.put("/api/admin/settings", json={
            "registration_mode": "invite_only",
        }, headers=admin_user["headers"])
        r = client.post("/api/admin/invites", json={},
                        headers=admin_user["headers"])
        token = r.json()["token"]
        data = pki_register(client, "invited2", "Invited User 2", token=token)
        assert data["user"]["username"] == "invited2"

    def test_invite_only_register_without_token_rejected(self, client, admin_user):
        """In invite_only mode, registration without a token is rejected."""
        client.put("/api/admin/settings", json={
            "registration_mode": "invite_only",
        }, headers=admin_user["headers"])
        identity = PKIIdentity()
        r = client.post("/api/auth/pki/challenge", json={})
        challenge = r.json()["challenge"]
        r = client.post("/api/auth/pki/register", json={
            "username": "noinvite",
            "display_name": "No Invite",
            "public_key": identity.public_key_b64url,
            "challenge": challenge,
            "signature": identity.sign(challenge),
        })
        assert r.status_code == 403

    def test_invite_only_request_access_rejected(self, client, admin_user):
        """In invite_only mode, requesting access is not allowed."""
        client.put("/api/admin/settings", json={
            "registration_mode": "invite_only",
        }, headers=admin_user["headers"])
        identity = PKIIdentity()
        r = client.post("/api/auth/request-access", json={
            "username": "requester",
            "display_name": "Requester",
            "auth_method": "pki",
            "public_key": identity.public_key_b64url,
            "challenge": "dummy",
            "signature": identity.sign("dummy"),
        })
        assert r.status_code == 403


class TestAdminSettings:
    def test_get_settings(self, client, admin_user):
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert "registration_mode" in data
        assert "auth_methods" in data

    def test_update_settings(self, client, admin_user):
        r = client.put("/api/admin/settings", json={
            "server_name": "Test Server",
            "registration_mode": "open",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        # Verify
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert r.json()["server_name"] == "Test Server"
        assert r.json()["registration_mode"] == "open"

    def test_set_invite_only_mode(self, client, admin_user):
        r = client.put("/api/admin/settings", json={
            "registration_mode": "invite_only",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert r.json()["registration_mode"] == "invite_only"

    def test_all_registration_modes_accepted(self, client, admin_user):
        for mode in ("invite", "invite_only", "approval", "open"):
            r = client.put("/api/admin/settings", json={
                "registration_mode": mode,
            }, headers=admin_user["headers"])
            assert r.status_code == 200, f"Mode '{mode}' should be accepted"
            r = client.get("/api/admin/settings", headers=admin_user["headers"])
            assert r.json()["registration_mode"] == mode

    def test_invalid_registration_mode_rejected(self, client, admin_user):
        r = client.put("/api/admin/settings", json={
            "registration_mode": "invalid_mode",
        }, headers=admin_user["headers"])
        assert r.status_code == 400

    def test_non_admin_cannot_read_settings(self, client, admin_user, regular_user):
        r = client.get("/api/admin/settings", headers=regular_user["headers"])
        assert r.status_code == 403

    def test_non_admin_cannot_update_settings(self, client, admin_user, regular_user):
        r = client.put("/api/admin/settings", json={"server_name": "Hacked"},
                       headers=regular_user["headers"])
        assert r.status_code == 403


class TestAdminSetup:
    def test_initial_setup(self, client, admin_user):
        r = client.post("/api/admin/setup", json={
            "server_name": "My Chat",
            "registration_mode": "invite",
        }, headers=admin_user["headers"])
        assert r.status_code == 200

    def test_setup_cannot_run_twice(self, client, admin_user):
        client.post("/api/admin/setup", json={"server_name": "My Chat"},
                    headers=admin_user["headers"])
        r = client.post("/api/admin/setup", json={"server_name": "Again"},
                        headers=admin_user["headers"])
        assert r.status_code == 400


class TestAdminUserRoles:
    def test_owner_can_change_user_role(self, client, admin_user, regular_user):
        r = client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        assert r.status_code == 200
        # Verify the user can now access admin endpoints
        r = client.get("/api/admin/settings",
                       headers=regular_user["headers"])
        assert r.status_code == 200

    def test_admin_can_promote_user_to_admin(self, client, admin_user, regular_user,
                                              second_regular_user):
        # Promote regular_user to admin
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        # Admin can promote a regular user to admin (same rank)
        r = client.put(
            f"/api/admin/users/{second_regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=regular_user["headers"],
        )
        assert r.status_code == 200

    def test_admin_cannot_promote_to_owner(self, client, admin_user, regular_user,
                                            second_regular_user):
        # Promote regular_user to admin
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        # Admin cannot promote anyone to owner (above their rank)
        r = client.put(
            f"/api/admin/users/{second_regular_user['user']['id']}/role",
            json={"role": "owner"},
            headers=regular_user["headers"],
        )
        assert r.status_code == 403

    def test_admin_cannot_demote_another_admin(self, client, admin_user, regular_user,
                                                second_regular_user):
        # Promote both to admin
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        client.put(
            f"/api/admin/users/{second_regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        # Admin cannot demote another admin (same rank)
        r = client.put(
            f"/api/admin/users/{second_regular_user['user']['id']}/role",
            json={"role": "user"},
            headers=regular_user["headers"],
        )
        assert r.status_code == 403

    def test_admin_cannot_demote_owner(self, client, admin_user, regular_user):
        # Promote regular_user to admin
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        # Admin cannot demote an owner
        r = client.put(
            f"/api/admin/users/{admin_user['user']['id']}/role",
            json={"role": "user"},
            headers=regular_user["headers"],
        )
        assert r.status_code == 403

    def test_invalid_role_rejected(self, client, admin_user, regular_user):
        r = client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "superadmin"},
            headers=admin_user["headers"],
        )
        assert r.status_code == 400


class TestAdminRecoveryTokens:
    def test_create_recovery_token(self, client, admin_user, regular_user):
        r = client.post("/api/admin/recovery-tokens", json={
            "user_id": regular_user["user"]["id"],
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        assert "token" in r.json()

    def test_list_recovery_tokens(self, client, admin_user, regular_user):
        client.post("/api/admin/recovery-tokens", json={
            "user_id": regular_user["user"]["id"],
        }, headers=admin_user["headers"])
        r = client.get("/api/admin/recovery-tokens",
                       headers=admin_user["headers"])
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_recovery_token_login(self, client, admin_user, regular_user):
        r = client.post("/api/admin/recovery-tokens", json={
            "user_id": regular_user["user"]["id"],
        }, headers=admin_user["headers"])
        token = r.json()["token"]
        r = client.post("/api/auth/recover-account", json={"token": token})
        assert r.status_code == 200
        assert r.json()["user"]["username"] == "regular"

    def test_non_admin_cannot_create_recovery_token(self, client, admin_user,
                                                      regular_user):
        r = client.post("/api/admin/recovery-tokens", json={
            "user_id": admin_user["user"]["id"],
        }, headers=regular_user["headers"])
        assert r.status_code == 403


class TestAdminUsersList:
    def test_owner_can_list_users(self, client, admin_user, regular_user):
        r = client.get("/api/admin/users", headers=admin_user["headers"])
        assert r.status_code == 200
        users = r.json()
        assert len(users) >= 2
        usernames = [u["username"] for u in users]
        assert "admin" in usernames
        assert "regular" in usernames

    def test_admin_can_list_users(self, client, admin_user, regular_user):
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        r = client.get("/api/admin/users", headers=regular_user["headers"])
        assert r.status_code == 200
        assert len(r.json()) >= 2

    def test_regular_user_cannot_list_admin_users(self, client, admin_user, regular_user):
        r = client.get("/api/admin/users", headers=regular_user["headers"])
        assert r.status_code == 403


class TestLastOwnerProtection:
    def test_cannot_demote_last_owner(self, client, admin_user):
        """The sole owner cannot be demoted."""
        r = client.put(
            f"/api/admin/users/{admin_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        assert r.status_code == 400
        assert r.json().get("last_owner") is True

    def test_can_demote_owner_when_another_exists(self, client, admin_user, regular_user):
        """When there are multiple owners, one can demote themselves."""
        # Promote regular_user to owner
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "owner"},
            headers=admin_user["headers"],
        )
        # Now admin_user can demote themselves (self-demotion allowed)
        r = client.put(
            f"/api/admin/users/{admin_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        assert r.status_code == 200

    def test_owner_cannot_demote_another_owner(self, client, admin_user, regular_user):
        """Owners cannot demote other owners (same-rank restriction)."""
        # Promote regular_user to owner
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "owner"},
            headers=admin_user["headers"],
        )
        # admin_user tries to demote regular_user (another owner) — should fail
        r = client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        assert r.status_code == 403


class TestServerArchive:
    def test_owner_can_archive_server(self, client, admin_user):
        r = client.post("/api/admin/archive-server",
                        headers=admin_user["headers"])
        assert r.status_code == 200

    def test_owner_can_unarchive_server(self, client, admin_user):
        client.post("/api/admin/archive-server",
                    headers=admin_user["headers"])
        r = client.post("/api/admin/unarchive-server",
                        headers=admin_user["headers"])
        assert r.status_code == 200

    def test_non_owner_cannot_archive_server(self, client, admin_user, regular_user):
        # Promote to admin (not owner)
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        r = client.post("/api/admin/archive-server",
                        headers=regular_user["headers"])
        assert r.status_code == 403

    def test_non_owner_cannot_unarchive_server(self, client, admin_user, regular_user):
        client.post("/api/admin/archive-server",
                    headers=admin_user["headers"])
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        r = client.post("/api/admin/unarchive-server",
                        headers=regular_user["headers"])
        assert r.status_code == 403

    def test_config_reflects_archived_status(self, client, admin_user):
        r = client.get("/api/config")
        assert r.json()["server_archived"] is False
        client.post("/api/admin/archive-server",
                    headers=admin_user["headers"])
        r = client.get("/api/config")
        assert r.json()["server_archived"] is True
        client.post("/api/admin/unarchive-server",
                    headers=admin_user["headers"])
        r = client.get("/api/config")
        assert r.json()["server_archived"] is False

    def test_admin_settings_reflects_archived_status(self, client, admin_user):
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert r.json()["server_archived"] is False
        client.post("/api/admin/archive-server",
                    headers=admin_user["headers"])
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert r.json()["server_archived"] is True
