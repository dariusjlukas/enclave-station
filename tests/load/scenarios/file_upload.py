"""Scenario 4: File upload stress.

Tests file upload throughput — both small single-request uploads and
larger uploads — plus file downloads.
"""

import os
import uuid

import gevent
from locust import HttpUser, between, task

from helpers.auth import (
    PKIIdentity,
    auth_header,
    ensure_admin_setup,
    pki_register,
    unique_username,
)
from helpers.data_setup import create_space, enable_space_tools, join_space

# One-time scenario setup
_setup_lock = gevent.lock.Semaphore()
_scenario_setup_done = False
_shared_space_id = None


def _ensure_scenario_setup(client):
    global _scenario_setup_done, _shared_space_id

    admin = ensure_admin_setup(client)

    with _setup_lock:
        if _scenario_setup_done:
            return

        sp = create_space(client, admin["token"], "Load Files Space")
        _shared_space_id = sp["id"]
        enable_space_tools(client, admin["token"], _shared_space_id)

        _scenario_setup_done = True


def _random_bytes(size):
    """Generate random bytes for file content."""
    return os.urandom(size)


class FileUploadUser(HttpUser):
    """Simulates users uploading and downloading files."""

    wait_time = between(1, 3)

    def on_start(self):
        _ensure_scenario_setup(self.client)

        self._identity = PKIIdentity()
        username = unique_username()
        data = pki_register(self.client, username, f"User {username}",
                            self._identity)
        self._token = data["token"]
        self._headers = auth_header(self._token)

        join_space(self.client, self._token, _shared_space_id)

        self._uploaded_file_ids = []

    def _upload_file(self, size, name_tag):
        """Upload a file using raw body + query params."""
        content = _random_bytes(size)
        filename = f"loadtest_{uuid.uuid4().hex[:8]}.bin"

        r = self.client.post(
            f"/api/spaces/{_shared_space_id}/files/upload"
            f"?filename={filename}&content_type=application/octet-stream",
            data=content,
            headers={**self._headers, "Content-Type": "application/octet-stream"},
            name=f"/api/spaces/:id/files/upload [{name_tag}]")

        if r.status_code == 200:
            file_data = r.json()
            file_id = file_data.get("id")
            if file_id:
                self._uploaded_file_ids.append(file_id)
                if len(self._uploaded_file_ids) > 50:
                    self._uploaded_file_ids = self._uploaded_file_ids[-25:]

    @task(5)
    def small_file_upload(self):
        """Upload a small file (1-10 KB)."""
        size = 1024 * (1 + int(uuid.uuid4().int % 10))
        self._upload_file(size, "small")

    @task(2)
    def medium_file_upload(self):
        """Upload a medium file (50-200 KB)."""
        size = 1024 * (50 + int(uuid.uuid4().int % 150))
        self._upload_file(size, "medium")

    @task(3)
    def download_file(self):
        """Download a previously uploaded file."""
        if not self._uploaded_file_ids:
            return

        file_id = self._uploaded_file_ids[
            int(uuid.uuid4().int % len(self._uploaded_file_ids))]
        self.client.get(
            f"/api/spaces/{_shared_space_id}/files/{file_id}/download",
            headers=self._headers,
            name="/api/spaces/:id/files/:id/download")

    @task(2)
    def list_files(self):
        """List files in the space."""
        self.client.get(
            f"/api/spaces/{_shared_space_id}/files",
            headers=self._headers,
            name="/api/spaces/:id/files")
