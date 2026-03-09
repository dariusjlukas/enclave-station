"""Tests for user endpoints: profile, PKI keys, recovery keys."""

import pytest
from conftest import PKIIdentity, auth_header, pki_register


class TestUserProfile:
    def test_get_own_profile(self, client, admin_user):
        r = client.get("/api/users/me", headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_update_profile(self, client, admin_user):
        r = client.put("/api/users/me", json={
            "display_name": "New Name",
            "bio": "Hello world",
            "status": "busy",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data["display_name"] == "New Name"
        assert data["bio"] == "Hello world"
        assert data["status"] == "busy"

    def test_list_all_users(self, client, admin_user, regular_user):
        r = client.get("/api/users", headers=admin_user["headers"])
        assert r.status_code == 200
        usernames = [u["username"] for u in r.json()]
        assert "admin" in usernames
        assert "regular" in usernames

    def test_delete_account(self, client, admin_user):
        # Create a throwaway user to delete
        data = pki_register(client, "deleteme", "Delete Me")
        headers = auth_header(data["token"])
        r = client.delete("/api/users/me", headers=headers)
        assert r.status_code == 200


class TestUserAvatarFields:
    def test_profile_has_avatar_fields(self, client, admin_user):
        r = client.get("/api/users/me", headers=admin_user["headers"])
        assert r.status_code == 200
        data = r.json()
        assert "avatar_file_id" in data
        assert "profile_color" in data

    def test_update_profile_color(self, client, admin_user):
        r = client.put("/api/users/me", json={
            "display_name": "Admin User",
            "profile_color": "#3182ce",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["profile_color"] == "#3182ce"

    def test_user_list_has_avatar_fields(self, client, admin_user, regular_user):
        r = client.get("/api/users", headers=admin_user["headers"])
        assert r.status_code == 200
        for u in r.json():
            assert "avatar_file_id" in u
            assert "profile_color" in u


class TestUserAvatar:
    def test_upload_avatar(self, client, admin_user):
        import struct, zlib
        def make_png():
            raw = b'\x00\x00\x00\x00'
            data = zlib.compress(raw)
            def chunk(ctype, body):
                c = ctype + body
                return struct.pack('>I', len(body)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
            ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
            return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', data) + chunk(b'IEND', b'')
        png_data = make_png()
        r = client.post("/api/users/me/avatar",
                        content=png_data,
                        headers={
                            **admin_user["headers"],
                            "Content-Type": "image/png",
                        })
        assert r.status_code == 200
        assert r.json()["avatar_file_id"] != ""

    def test_delete_avatar(self, client, admin_user):
        r = client.delete("/api/users/me/avatar",
                          headers=admin_user["headers"])
        assert r.status_code == 200
        assert r.json()["avatar_file_id"] == ""

    def test_avatar_served_publicly(self, client, admin_user):
        import struct, zlib
        def make_png():
            raw = b'\x00\x00\x00\x00'
            data = zlib.compress(raw)
            def chunk(ctype, body):
                c = ctype + body
                return struct.pack('>I', len(body)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
            ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
            return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', data) + chunk(b'IEND', b'')
        png_data = make_png()
        r = client.post("/api/users/me/avatar",
                        content=png_data,
                        headers={
                            **admin_user["headers"],
                            "Content-Type": "image/png",
                        })
        file_id = r.json()["avatar_file_id"]
        # Fetch without auth
        r = client.get(f"/api/avatars/{file_id}")
        assert r.status_code == 200
        assert r.headers.get("content-type") == "image/png"
        assert "immutable" in r.headers.get("cache-control", "")


class TestPKIKeys:
    def test_list_keys(self, client, admin_user):
        r = client.get("/api/users/me/keys", headers=admin_user["headers"])
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_add_additional_key(self, client, admin_user):
        # Get challenge
        r = client.post("/api/users/me/keys/challenge",
                        headers=admin_user["headers"])
        assert r.status_code == 200
        challenge = r.json()["challenge"]
        # Sign with new key
        new_key = PKIIdentity()
        sig = new_key.sign(challenge)
        r = client.post("/api/users/me/keys", json={
            "public_key": new_key.public_key_b64url,
            "challenge": challenge,
            "signature": sig,
            "device_name": "Test Device",
        }, headers=admin_user["headers"])
        assert r.status_code == 200
        # Verify it shows up in the list
        r = client.get("/api/users/me/keys", headers=admin_user["headers"])
        names = [k.get("device_name", "") for k in r.json()]
        assert "Test Device" in names

    def test_cannot_add_key_with_bad_signature(self, client, admin_user):
        r = client.post("/api/users/me/keys/challenge",
                        headers=admin_user["headers"])
        challenge = r.json()["challenge"]
        key1 = PKIIdentity()
        key2 = PKIIdentity()
        r = client.post("/api/users/me/keys", json={
            "public_key": key1.public_key_b64url,
            "challenge": challenge,
            "signature": key2.sign(challenge),
        }, headers=admin_user["headers"])
        assert r.status_code == 401


class TestRecoveryKeys:
    def test_recovery_key_count(self, client, admin_user):
        r = client.get("/api/users/me/recovery-keys/count",
                       headers=admin_user["headers"])
        assert r.status_code == 200
        assert "remaining" in r.json()

    def test_regenerate_recovery_keys(self, client, admin_user):
        r = client.post("/api/users/me/recovery-keys/regenerate",
                        headers=admin_user["headers"])
        assert r.status_code == 200
        keys = r.json()["recovery_keys"]
        assert len(keys) == 8
        # Verify count is 8
        r = client.get("/api/users/me/recovery-keys/count",
                       headers=admin_user["headers"])
        assert r.json()["remaining"] == 8
