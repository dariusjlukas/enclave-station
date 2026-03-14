"""Tests for server lockdown endpoints: lockdown, unlock, login prevention."""

from conftest import auth_header, pki_login, password_register


class TestLockdownAccess:
    """Only owners can trigger lockdown/unlock."""

    def test_owner_can_lockdown_server(self, client, admin_user):
        r = client.post("/api/admin/lockdown-server",
                        headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_owner_can_unlock_server(self, client, admin_user):
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        r = client.post("/api/admin/unlock-server",
                        headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_admin_cannot_lockdown_server(self, client, admin_user, regular_user):
        # Promote regular_user to admin
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        r = client.post("/api/admin/lockdown-server",
                        headers=regular_user["headers"])
        assert r.status_code == 403

    def test_admin_cannot_unlock_server(self, client, admin_user, regular_user):
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        r = client.post("/api/admin/unlock-server",
                        headers=regular_user["headers"])
        assert r.status_code == 403

    def test_regular_user_cannot_lockdown_server(self, client, admin_user, regular_user):
        r = client.post("/api/admin/lockdown-server",
                        headers=regular_user["headers"])
        assert r.status_code == 403

    def test_regular_user_cannot_unlock_server(self, client, admin_user, regular_user):
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        r = client.post("/api/admin/unlock-server",
                        headers=regular_user["headers"])
        assert r.status_code == 403


class TestLockdownSettingsReflection:
    """Lockdown state is reflected in admin settings."""

    def test_settings_show_locked_down_false_by_default(self, client, admin_user):
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["server_locked_down"] is False

    def test_settings_show_locked_down_true_after_lockdown(self, client, admin_user):
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["server_locked_down"] is True

    def test_settings_show_locked_down_false_after_unlock(self, client, admin_user):
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        client.post("/api/admin/unlock-server",
                    headers=admin_user["headers"])
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["server_locked_down"] is False


class TestLockdownPreventsLogin:
    """During lockdown, non-admin/non-owner users cannot log in."""

    def test_pki_login_blocked_for_regular_user(self, client, admin_user, regular_user):
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        # Try to log in as regular user via PKI
        identity = regular_user["identity"]
        r = client.post("/api/auth/pki/challenge",
                        json={"public_key": identity.public_key_b64url})
        assert r.status_code == 200
        challenge = r.json()["challenge"]
        r = client.post("/api/auth/pki/login", json={
            "public_key": identity.public_key_b64url,
            "challenge": challenge,
            "signature": identity.sign(challenge),
        })
        assert r.status_code == 403
        assert "lockdown" in r.json()["error"].lower()

    def test_pki_login_allowed_for_owner_during_lockdown(self, client, admin_user):
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        # Owner should still be able to log in
        data = pki_login(client, admin_user["identity"])
        assert "token" in data

    def test_pki_login_allowed_for_admin_during_lockdown(self, client, admin_user,
                                                          regular_user):
        # Promote to admin first
        client.put(
            f"/api/admin/users/{regular_user['user']['id']}/role",
            json={"role": "admin"},
            headers=admin_user["headers"],
        )
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        # Admin should still be able to log in
        data = pki_login(client, regular_user["identity"])
        assert "token" in data

    def test_password_login_blocked_for_regular_user(self, client, admin_user):
        # Enable password auth and register a password user
        client.put("/api/admin/settings",
                   json={"auth_methods": ["passkey", "pki", "password"]},
                   headers=admin_user["headers"])
        password_register(client, "pwuser", "PW User", "TestPass123!")
        # Lockdown
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        # Regular password user cannot log in
        r = client.post("/api/auth/password/login", json={
            "username": "pwuser",
            "password": "TestPass123!",
        })
        assert r.status_code == 403
        assert "lockdown" in r.json()["error"].lower()

    def test_login_allowed_after_lockdown_lifted(self, client, admin_user, regular_user):
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        # Verify login blocked
        identity = regular_user["identity"]
        r = client.post("/api/auth/pki/challenge",
                        json={"public_key": identity.public_key_b64url})
        challenge = r.json()["challenge"]
        r = client.post("/api/auth/pki/login", json={
            "public_key": identity.public_key_b64url,
            "challenge": challenge,
            "signature": identity.sign(challenge),
        })
        assert r.status_code == 403
        # Unlock
        client.post("/api/admin/unlock-server",
                    headers=admin_user["headers"])
        # Now login should work
        data = pki_login(client, regular_user["identity"])
        assert "token" in data


class TestLockdownExistingSessions:
    """Existing sessions behavior after lockdown."""

    def test_regular_user_session_still_valid_for_api_during_lockdown(
            self, client, admin_user, regular_user):
        """Existing sessions are not invalidated (only WS connections are kicked).
        The session token itself still works for API calls like /api/users/me."""
        client.post("/api/admin/lockdown-server",
                    headers=admin_user["headers"])
        r = client.get("/api/users/me", headers=regular_user["headers"])
        # Session token is not invalidated — the user is kicked from WS,
        # but their API session remains valid
        assert r.status_code == 200
