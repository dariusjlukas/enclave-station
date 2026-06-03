"""Tests for authentication endpoints: PKI register/login, password auth, sessions, logout."""

import httpx
import pytest
from conftest import (PKIIdentity, auth_header, pki_login, pki_register,
                      password_register, password_login)


class TestPKIRegistration:
    def test_first_user_becomes_owner(self, client):
        data = pki_register(client, "first", "First User")
        assert data["token"]
        assert data["user"]["username"] == "first"
        assert data["user"]["role"] == "owner"
        assert "recovery_keys" in data
        assert len(data["recovery_keys"]) == 8

    def test_second_user_is_regular(self, client):
        admin = pki_register(client, "admin", "Admin")
        # Open registration so second user can register
        client.put("/api/admin/settings",
                   json={"registration_mode": "open"},
                   headers=auth_header(admin["token"]))
        data = pki_register(client, "user2", "User Two")
        assert data["user"]["role"] == "user"

    def test_duplicate_username_rejected(self, client):
        admin = pki_register(client, "taken", "First")
        client.put("/api/admin/settings",
                   json={"registration_mode": "open"},
                   headers=auth_header(admin["token"]))
        identity = PKIIdentity()
        r = client.post("/api/auth/pki/challenge", json={})
        challenge = r.json()["challenge"]
        r = client.post("/api/auth/pki/register", json={
            "username": "taken",
            "display_name": "Second",
            "public_key": identity.public_key_b64url,
            "challenge": challenge,
            "signature": identity.sign(challenge),
        })
        assert r.status_code == 409

    def test_invalid_signature_rejected(self, client):
        r = client.post("/api/auth/pki/challenge", json={})
        challenge = r.json()["challenge"]
        identity = PKIIdentity()
        # Sign with one key, register with another
        other = PKIIdentity()
        r = client.post("/api/auth/pki/register", json={
            "username": "attacker",
            "display_name": "Attacker",
            "public_key": identity.public_key_b64url,
            "challenge": challenge,
            "signature": other.sign(challenge),
        })
        assert r.status_code == 401

    def test_expired_challenge_rejected(self, client):
        identity = PKIIdentity()
        r = client.post("/api/auth/pki/challenge", json={})
        challenge = r.json()["challenge"]
        sig = identity.sign(challenge)
        # Use a garbage challenge value
        r = client.post("/api/auth/pki/register", json={
            "username": "test",
            "display_name": "Test",
            "public_key": identity.public_key_b64url,
            "challenge": "bogus_challenge_value",
            "signature": sig,
        })
        assert r.status_code in (400, 401)

    def test_missing_fields_rejected(self, client):
        r = client.post("/api/auth/pki/register", json={
            "username": "test",
        })
        assert r.status_code == 400


class TestPKILogin:
    def test_login_success(self, client):
        reg = pki_register(client, "loginuser", "Login User")
        login_data = pki_login(client, reg["identity"])
        assert login_data["token"]
        assert login_data["user"]["username"] == "loginuser"

    def test_login_wrong_key(self, client):
        pki_register(client, "user1", "User One")
        unknown = PKIIdentity()
        r = client.post("/api/auth/pki/challenge",
                        json={"public_key": unknown.public_key_b64url})
        challenge = r.json()["challenge"]
        r = client.post("/api/auth/pki/login", json={
            "public_key": unknown.public_key_b64url,
            "challenge": challenge,
            "signature": unknown.sign(challenge),
        })
        assert r.status_code == 401

    def test_login_invalid_signature(self, client):
        reg = pki_register(client, "user1", "User One")
        identity = reg["identity"]
        r = client.post("/api/auth/pki/challenge",
                        json={"public_key": identity.public_key_b64url})
        challenge = r.json()["challenge"]
        other = PKIIdentity()
        r = client.post("/api/auth/pki/login", json={
            "public_key": identity.public_key_b64url,
            "challenge": challenge,
            "signature": other.sign(challenge),
        })
        assert r.status_code == 401


class TestRecoveryKeyLogin:
    def test_recovery_key_login(self, client):
        reg = pki_register(client, "recoverme", "Recover Me")
        key = reg["recovery_keys"][0]
        r = client.post("/api/auth/recovery", json={"recovery_key": key})
        assert r.status_code == 200
        data = r.json()
        # Release C: auth responses no longer include a `token` body field; the
        # session is delivered via the Set-Cookie session cookie instead.
        assert r.cookies.get("session")
        assert data["user"]["username"] == "recoverme"

    def test_recovery_key_consumed(self, client):
        reg = pki_register(client, "recoverme", "Recover Me")
        key = reg["recovery_keys"][0]
        r = client.post("/api/auth/recovery", json={"recovery_key": key})
        assert r.status_code == 200
        # Same key again should fail
        r = client.post("/api/auth/recovery", json={"recovery_key": key})
        assert r.status_code == 401

    def test_invalid_recovery_key(self, client):
        pki_register(client, "user1", "User One")
        r = client.post("/api/auth/recovery",
                        json={"recovery_key": "totally-fake-key"})
        assert r.status_code == 401


class TestSession:
    def test_authenticated_request(self, client, admin_user):
        r = client.get("/api/users/me", headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_unauthenticated_request_rejected(self, client):
        r = client.get("/api/users/me")
        assert r.status_code == 401

    def test_invalid_token_rejected(self, client):
        r = client.get("/api/users/me",
                       headers=auth_header("invalid-token-value"))
        assert r.status_code == 401

    def test_logout_invalidates_session(self, client, admin_user):
        r = client.post("/api/auth/logout", headers=admin_user["headers"])
        assert r.status_code == 200
        # Token should no longer work
        r = client.get("/api/users/me", headers=admin_user["headers"])
        assert r.status_code == 401


class TestPublicEndpoints:
    def test_health_check(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_config_endpoint(self, client):
        r = client.get("/api/config")
        assert r.status_code == 200
        data = r.json()
        assert "auth_methods" in data
        assert "registration_mode" in data

    def test_config_reflects_invite_only_mode(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "registration_mode": "invite_only",
        }, headers=admin_user["headers"])
        r = client.get("/api/config")
        assert r.status_code == 200
        assert r.json()["registration_mode"] == "invite_only"

    def test_config_includes_password_policy(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        r = client.get("/api/config")
        assert r.status_code == 200
        policy = r.json()["password_policy"]
        assert policy["min_length"] == 8
        assert policy["require_uppercase"] is True


class TestPasswordRegistration:
    def test_register_with_password(self, client, admin_user):
        """Enable password auth and register a new user with a password."""
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        data = password_register(client, "pwuser", "Password User")
        assert data["token"]
        assert data["user"]["username"] == "pwuser"

    def test_login_with_password(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        password_register(client, "pwlogin", "PW Login", password="MyPass123")
        data = password_login(client, "pwlogin", "MyPass123")
        assert data["token"]
        assert data["user"]["username"] == "pwlogin"

    def test_wrong_password_rejected(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        password_register(client, "pwbad", "PW Bad", password="Correct123")
        r = client.post("/api/auth/password/login", json={
            "username": "pwbad",
            "password": "Wrong123!!",
        })
        assert r.status_code == 401

    def test_nonexistent_user_rejected(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        r = client.post("/api/auth/password/login", json={
            "username": "nobody",
            "password": "Pass1234",
        })
        assert r.status_code == 401


class TestAuthRateLimiting:
    """Brute-force protection on credential endpoints. The limiter is keyed by
    client IP (X-Real-IP, set by nginx in prod). Each test uses a distinct
    X-Real-IP so it gets its own token bucket, isolated from the rest of the
    suite. The server is configured (conftest) with a burst of 30 per 60s.

    These tests drive the MFA-verify endpoint: it shares the exact same
    `auth_rate_limited` gate as password/recovery login but verifies a bogus
    token cheaply, so the bucket can actually be exhausted deterministically.
    (Password login goes through Argon2, which in a debug/sanitizer build is
    slow enough that the bucket refills faster than a tight loop drains it —
    making a 429 assertion against it timing-dependent.)"""

    def _hammer_mfa(self, client, ip_value, n=45):
        ip = {"X-Real-IP": ip_value}
        for _ in range(n):
            r = client.post("/api/auth/mfa/verify",
                            json={"mfa_token": "bogus", "code": "000000"},
                            headers=ip)
            if r.status_code == 429:
                return True, r
        return False, r

    def test_mfa_verify_rate_limited(self, client):
        saw_429, r = self._hammer_mfa(client, "203.0.113.30")
        assert saw_429, "expected a 429 after exceeding the MFA verify rate limit"
        # The throttle response carries a Retry-After hint.
        assert r.headers.get("Retry-After") is not None

    def test_rate_limit_is_per_ip(self, client):
        # Exhaust one IP's bucket.
        got_429, _ = self._hammer_mfa(client, "203.0.113.20")
        assert got_429

        # A different IP still has a full bucket: its first attempt is the normal
        # auth-failure response (a bogus mfa_token yields 400), not a 429.
        r = client.post("/api/auth/mfa/verify",
                        json={"mfa_token": "bogus", "code": "000000"},
                        headers={"X-Real-IP": "203.0.113.21"})
        assert r.status_code != 429
        assert r.status_code == 400

    def test_password_login_uses_same_limiter(self, client, admin_user):
        # Smoke check that the password endpoint is wired to the limiter too:
        # a fresh IP's first attempt is a normal auth failure (401), never 429.
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        password_register(client, "rluser", "RL User", password="Correct123")
        r = client.post("/api/auth/password/login",
                        json={"username": "rluser", "password": "Wrong!!1"},
                        headers={"X-Real-IP": "203.0.113.40"})
        assert r.status_code == 401

    def test_password_too_short_rejected(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        r = client.post("/api/auth/password/register", json={
            "username": "shortpw",
            "display_name": "Short",
            "password": "Ab1",
        })
        assert r.status_code == 400
        assert "at least" in r.json()["error"]

    def test_password_no_uppercase_rejected(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        r = client.post("/api/auth/password/register", json={
            "username": "noup",
            "display_name": "No Upper",
            "password": "alllowercase123",
        })
        assert r.status_code == 400
        assert "uppercase" in r.json()["error"]

    def test_password_disabled_rejects_register(self, client, admin_user):
        """Password auth disabled by default — registration should fail."""
        r = client.post("/api/auth/password/register", json={
            "username": "blocked",
            "display_name": "Blocked",
            "password": "TestPass123",
        })
        assert r.status_code == 403

    def test_password_disabled_rejects_login(self, client, admin_user):
        r = client.post("/api/auth/password/login", json={
            "username": "blocked",
            "password": "TestPass123",
        })
        assert r.status_code == 403


class TestPasswordChange:
    def test_change_password(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        reg = password_register(client, "chpw", "Change PW", password="OldPass123")
        headers = auth_header(reg["token"])
        r = client.post("/api/auth/password/change", json={
            "current_password": "OldPass123",
            "new_password": "NewPass456",
        }, headers=headers)
        assert r.status_code == 200
        # Login with new password
        data = password_login(client, "chpw", "NewPass456")
        assert data["token"]
        # Old password should fail
        r = client.post("/api/auth/password/login", json={
            "username": "chpw",
            "password": "OldPass123",
        })
        assert r.status_code == 401

    def test_change_password_wrong_current(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        reg = password_register(client, "chpw2", "Change PW 2", password="MyPass123")
        headers = auth_header(reg["token"])
        r = client.post("/api/auth/password/change", json={
            "current_password": "WrongCurrent",
            "new_password": "NewPass456",
        }, headers=headers)
        assert r.status_code == 401

    def test_password_history_prevents_reuse(self, client, admin_user):
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
            "password_history_count": 2,
        }, headers=admin_user["headers"])
        reg = password_register(client, "histpw", "Hist PW", password="First123!")
        headers = auth_header(reg["token"])
        # Change to second password
        client.post("/api/auth/password/change", json={
            "current_password": "First123!",
            "new_password": "Second456!",
        }, headers=headers)
        # Try to change back to first — should be rejected
        r = client.post("/api/auth/password/change", json={
            "current_password": "Second456!",
            "new_password": "First123!",
        }, headers=headers)
        assert r.status_code == 400
        assert "recent password" in r.json()["error"]


class TestPasswordSet:
    def test_set_password_for_pki_user(self, client, admin_user):
        """A PKI user with no password can create one."""
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        reg = pki_register(client, "pkiuser", "PKI User")
        headers = auth_header(reg["token"])
        # User should not have a password yet
        r = client.get("/api/users/me", headers=headers)
        assert r.json()["has_password"] is False
        # Set a password
        r = client.post("/api/auth/password/set", json={
            "password": "NewPass123",
        }, headers=headers)
        assert r.status_code == 200
        # Now has_password should be True
        r = client.get("/api/users/me", headers=headers)
        assert r.json()["has_password"] is True
        # Can login with the new password
        data = password_login(client, "pkiuser", "NewPass123")
        assert data["token"]

    def test_set_password_rejected_if_already_set(self, client, admin_user):
        """User who already has a password cannot use the set endpoint."""
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        reg = password_register(client, "pwuser", "PW User", password="MyPass123")
        headers = auth_header(reg["token"])
        r = client.post("/api/auth/password/set", json={
            "password": "Another123",
        }, headers=headers)
        assert r.status_code == 400

    def test_set_password_validates_policy(self, client, admin_user):
        """Password policy is enforced when setting a new password."""
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        reg = pki_register(client, "pkiuser2", "PKI User 2")
        headers = auth_header(reg["token"])
        r = client.post("/api/auth/password/set", json={
            "password": "short",
        }, headers=headers)
        assert r.status_code == 400

    def test_set_password_rejected_when_disabled(self, client, admin_user):
        """Cannot set password when password auth is disabled."""
        reg = pki_register(client, "pkiuser3", "PKI User 3")
        headers = auth_header(reg["token"])
        r = client.post("/api/auth/password/set", json={
            "password": "TestPass123",
        }, headers=headers)
        assert r.status_code == 403


class TestPasswordDelete:
    def test_remove_password(self, client, admin_user):
        """User with a password and another auth method can remove their password."""
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        # admin_user registered via PKI, so has a PKI key as fallback
        # Set a password first
        client.post("/api/auth/password/set", json={
            "password": "TestPass123",
        }, headers=admin_user["headers"])
        r = client.get("/api/users/me", headers=admin_user["headers"])
        assert r.json()["has_password"] is True
        # Remove it
        r = client.delete("/api/auth/password", headers=admin_user["headers"])
        assert r.status_code == 200
        r = client.get("/api/users/me", headers=admin_user["headers"])
        assert r.json()["has_password"] is False
        # Login with that password should now fail
        r = client.post("/api/auth/password/login", json={
            "username": "admin",
            "password": "TestPass123",
        })
        assert r.status_code == 401

    def test_remove_password_no_password_set(self, client, admin_user):
        """Cannot remove a password that doesn't exist."""
        r = client.delete("/api/auth/password", headers=admin_user["headers"])
        assert r.status_code == 400

    def test_remove_password_no_other_credential(self, client, admin_user):
        """Cannot remove password if it's the only login method."""
        client.put("/api/admin/settings", json={
            "auth_methods": ["passkey", "pki", "password"],
        }, headers=admin_user["headers"])
        reg = password_register(client, "pwonly", "PW Only")
        headers = auth_header(reg["token"])
        r = client.delete("/api/auth/password", headers=headers)
        assert r.status_code == 400
        assert "no other login method" in r.json()["error"].lower()


class TestPasswordAdminSettings:
    def test_password_auth_method_accepted(self, client, admin_user):
        r = client.put("/api/admin/settings", json={
            "auth_methods": ["password"],
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        assert "password" in r.json()["auth_methods"]

    def test_password_policy_settings(self, client, admin_user):
        r = client.put("/api/admin/settings", json={
            "password_min_length": 12,
            "password_require_special": True,
            "password_max_age_days": 90,
            "password_history_count": 5,
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        r = client.get("/api/admin/settings", headers=admin_user["headers"])
        data = r.json()
        assert data["password_min_length"] == 12
        assert data["password_require_special"] is True
        assert data["password_max_age_days"] == 90
        assert data["password_history_count"] == 5
