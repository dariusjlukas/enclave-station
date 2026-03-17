"""Scenario 1: Auth load — registration and login throughput.

Stresses PKI challenge-response (ECDSA P-256 verification) and Argon2
password hashing, plus session token validation on every request.
"""

from locust import HttpUser, between, task

from helpers.auth import (
    PKIIdentity,
    auth_header,
    ensure_admin_setup,
    password_login,
    password_register,
    pki_login,
    pki_register,
    unique_username,
)


class AuthLoadUser(HttpUser):
    """Simulates users registering, logging in, and validating sessions."""

    wait_time = between(0.5, 2)

    def on_start(self):
        ensure_admin_setup(self.client)

        # Each Locust user pre-generates a PKI identity for login tests
        self._identity = PKIIdentity()
        username = unique_username()
        data = pki_register(self.client, username,
                            f"User {username}", self._identity)
        self._token = data["token"]
        self._headers = auth_header(self._token)

        # Also register a password user for password login tests
        self._pw_username = unique_username()
        self._pw_password = "LoadTest123!"
        password_register(self.client, self._pw_username,
                          f"User {self._pw_username}",
                          self._pw_password)

    @task(5)
    def token_validation(self):
        """GET /api/users/me — validates session token (every authed request does this)."""
        self.client.get("/api/users/me", headers=self._headers,
                        name="/api/users/me")

    @task(3)
    def pki_register_and_login(self):
        """Full PKI registration + login cycle (4 HTTP requests)."""
        identity = PKIIdentity()
        username = unique_username()
        pki_register(self.client, username, f"User {username}", identity)
        pki_login(self.client, identity)

    @task(2)
    def password_register_and_login(self):
        """Password registration + login cycle (2 HTTP requests)."""
        username = unique_username()
        pw = "LoadTest123!"
        password_register(self.client, username, f"User {username}", pw)
        password_login(self.client, username, pw)

    @task(1)
    def pki_login_existing(self):
        """Login with pre-registered PKI identity."""
        pki_login(self.client, self._identity)
