"""PKI and password auth helpers for Locust load tests.

Ported from tests/api/conftest.py — adapted from httpx.Client to
requests.Session (Locust's HTTP client).

Works with both Locust's HttpSession (which accepts `name=`) and
plain requests.Session (which does not). The `_post`/`_put`/`_get`
wrappers strip `name` for plain sessions.
"""

import base64
import uuid

import gevent

from cryptography.hazmat.primitives.asymmetric.ec import (
    ECDSA,
    SECP256R1,
    generate_private_key,
)
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _is_locust_client(client) -> bool:
    """Check if client is Locust's HttpSession (supports `name` kwarg)."""
    return type(client).__name__ == "HttpSession"


def _post(client, url, **kwargs):
    if not _is_locust_client(client):
        kwargs.pop("name", None)
    return client.post(url, **kwargs)


def _put(client, url, **kwargs):
    if not _is_locust_client(client):
        kwargs.pop("name", None)
    return client.put(url, **kwargs)


def _get(client, url, **kwargs):
    if not _is_locust_client(client):
        kwargs.pop("name", None)
    return client.get(url, **kwargs)


class PKIIdentity:
    """A P-256 ECDSA key pair that can sign challenges for PKI auth.

    Matches the frontend's Web Crypto API format:
    - Public key: SPKI DER bytes, base64url-encoded
    - Signature: raw r||s (IEEE P1363), base64url-encoded
    """

    def __init__(self):
        self._private_key = generate_private_key(SECP256R1())
        spki_der = self._private_key.public_key().public_bytes(
            Encoding.DER, PublicFormat.SubjectPublicKeyInfo
        )
        self.public_key_b64url = _base64url_encode(spki_der)

    def sign(self, message: str) -> str:
        """Sign message with ECDSA P-256 SHA-256, return base64url raw r||s."""
        der_sig = self._private_key.sign(message.encode(), ECDSA(SHA256()))
        r, s = decode_dss_signature(der_sig)
        raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
        return _base64url_encode(raw_sig)


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def pki_register(client, username: str, display_name: str,
                 identity: PKIIdentity | None = None,
                 token: str | None = None) -> dict:
    """Register a new user via PKI. Returns {token, user, identity}.

    `client` can be a Locust HttpUser's self.client (HttpSession)
    or a plain requests.Session.
    """
    if identity is None:
        identity = PKIIdentity()

    # Step 1: get a challenge
    r = _post(client, "/api/auth/pki/challenge", json={},
              name="/api/auth/pki/challenge [register]")
    r.raise_for_status()
    challenge = r.json()["challenge"]

    # Step 2: sign and register
    sig = identity.sign(challenge)
    body: dict = {
        "username": username,
        "display_name": display_name,
        "public_key": identity.public_key_b64url,
        "challenge": challenge,
        "signature": sig,
    }
    if token is not None:
        body["token"] = token

    r = _post(client, "/api/auth/pki/register", json=body,
              name="/api/auth/pki/register")
    r.raise_for_status()
    data = r.json()
    data["identity"] = identity
    return data


def pki_login(client, identity: PKIIdentity) -> dict:
    """Login via PKI. Returns {token, user}."""
    r = _post(client, "/api/auth/pki/challenge",
              json={"public_key": identity.public_key_b64url},
              name="/api/auth/pki/challenge [login]")
    r.raise_for_status()
    challenge = r.json()["challenge"]

    sig = identity.sign(challenge)
    r = _post(client, "/api/auth/pki/login", json={
        "public_key": identity.public_key_b64url,
        "challenge": challenge,
        "signature": sig,
    }, name="/api/auth/pki/login")
    r.raise_for_status()
    return r.json()


def password_register(client, username: str, display_name: str,
                      password: str = "TestPass123!",
                      token: str | None = None) -> dict:
    """Register a new user via password. Returns {token, user}."""
    body: dict = {
        "username": username,
        "display_name": display_name,
        "password": password,
    }
    if token is not None:
        body["token"] = token

    r = _post(client, "/api/auth/password/register", json=body,
              name="/api/auth/password/register")
    r.raise_for_status()
    return r.json()


def password_login(client, username: str,
                   password: str = "TestPass123!") -> dict:
    """Login via password. Returns {token, user}."""
    r = _post(client, "/api/auth/password/login", json={
        "username": username,
        "password": password,
    }, name="/api/auth/password/login")
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Global admin setup — shared across ALL scenarios via a single lock
# ---------------------------------------------------------------------------
_global_admin_lock = gevent.lock.Semaphore()
_global_admin_done = False
_global_admin_data = None


def ensure_admin_setup(client) -> dict:
    """Register the first user (becomes owner), enable open registration
    and password auth. Safe to call from any scenario — only runs once.

    Returns {token, user, identity, headers}."""
    global _global_admin_done, _global_admin_data

    with _global_admin_lock:
        if _global_admin_done:
            return _global_admin_data

        data = pki_register(client, "loadtest_admin", "Load Test Admin")
        headers = auth_header(data["token"])

        _put(client, "/api/admin/settings",
             json={"registration_mode": "open"},
             headers=headers,
             name="/api/admin/settings [setup]")

        _put(client, "/api/admin/settings",
             json={"auth_methods": ["passkey", "pki", "password"]},
             headers=headers,
             name="/api/admin/settings [setup]")

        _global_admin_data = {
            "token": data["token"],
            "user": data["user"],
            "identity": data["identity"],
            "headers": headers,
        }
        _global_admin_done = True
        return _global_admin_data


def unique_username() -> str:
    """Generate a unique username for load test users."""
    return f"lt_{uuid.uuid4().hex[:12]}"
