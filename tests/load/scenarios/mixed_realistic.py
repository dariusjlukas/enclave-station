"""Scenario 6: Combined realistic workload.

Simulates a realistic mix of all activity types to find emergent
bottlenecks from combined load. Each user opens a WebSocket for
messaging while also performing HTTP API operations.

Task weight distribution (mirrors realistic usage):
- WebSocket messaging: 30%
- Channel/space browsing: 25%
- Task/wiki/calendar CRUD: 20%
- Notifications + user profile: 10%
- Search: 10%
- File upload/download: 5%
"""

import os
import random
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
from helpers.data_setup import (
    create_calendar_event,
    create_public_channel,
    create_space,
    create_task_board,
    create_wiki_page,
    enable_space_tools,
    join_channel,
    join_space,
)
from helpers.ws_client import LocustWebSocket

# One-time scenario setup
_setup_lock = gevent.lock.Semaphore()
_scenario_setup_done = False
_shared_channel_id = None
_shared_space_id = None
_shared_board_id = None
_shared_board_default_column_id = None


def _ensure_scenario_setup(client):
    global _scenario_setup_done
    global _shared_channel_id, _shared_space_id
    global _shared_board_id, _shared_board_default_column_id

    admin = ensure_admin_setup(client)
    admin_token = admin["token"]
    headers = admin["headers"]

    with _setup_lock:
        if _scenario_setup_done:
            return

        ch = create_public_channel(client, admin_token, "load-mixed")
        _shared_channel_id = ch["id"]

        sp = create_space(client, admin_token, "Load Mixed Space")
        _shared_space_id = sp["id"]
        enable_space_tools(client, admin_token, _shared_space_id)

        board = create_task_board(client, admin_token, _shared_space_id)
        _shared_board_id = board["id"]

        r = client.get(
            f"/api/spaces/{_shared_space_id}/tasks/boards/{_shared_board_id}",
            headers=headers,
            name="/api/spaces/:id/tasks/boards/:id [setup]")
        if r.status_code == 200:
            columns = r.json().get("columns", [])
            if columns:
                _shared_board_default_column_id = columns[0]["id"]

        for i in range(3):
            create_wiki_page(client, admin_token, _shared_space_id,
                             f"Mixed Wiki {i}")
            create_calendar_event(client, admin_token, _shared_space_id,
                                  f"Mixed Event {i}")

        _scenario_setup_done = True


class RealisticUser(HttpUser):
    """Simulates a realistic user doing a mix of all platform activities.

    Extends HttpUser so Locust's self.client (HttpSession) handles HTTP.
    WebSocket is managed separately via LocustWebSocket.
    """

    wait_time = between(0.3, 1.5)

    def on_start(self):
        _ensure_scenario_setup(self.client)

        self._identity = PKIIdentity()
        username = unique_username()
        data = pki_register(self.client, username, f"User {username}",
                            self._identity)
        self._token = data["token"]
        self._headers = auth_header(self._token)

        join_channel(self.client, self._token, _shared_channel_id)
        join_space(self.client, self._token, _shared_space_id)

        # Open WebSocket
        host = self.environment.host
        ws_url = host.replace("http://", "ws://").replace("https://", "wss://")
        self._ws = LocustWebSocket(self.environment)
        self._ws.connect(f"{ws_url}/ws?token={self._token}")

        self._uploaded_file_ids = []
        self._task_ids = []

    def on_stop(self):
        if hasattr(self, "_ws") and self._ws:
            self._ws.close()

    # --- WebSocket messaging (30%) ---

    @task(6)
    def send_chat_message(self):
        self._ws.send_message(_shared_channel_id)

    @task(3)
    def send_typing(self):
        self._ws.send_typing(_shared_channel_id)

    @task(2)
    def mark_read(self):
        self._ws.mark_read(_shared_channel_id)

    @task(1)
    def add_reaction(self):
        self._ws.add_reaction(None, random.choice(["👍", "❤️", "🎉", "👀"]))

    # --- Channel/space browsing (25%) ---

    @task(4)
    def list_channels(self):
        self.client.get("/api/channels", headers=self._headers,
                        name="/api/channels")

    @task(4)
    def get_channel_messages(self):
        self.client.get(
            f"/api/channels/{_shared_channel_id}/messages?limit=50",
            headers=self._headers,
            name="/api/channels/:id/messages")

    @task(2)
    def list_spaces(self):
        self.client.get("/api/spaces", headers=self._headers,
                        name="/api/spaces")

    # --- Task/wiki/calendar CRUD (20%) ---

    @task(2)
    def create_task(self):
        if not _shared_board_default_column_id:
            return
        r = self.client.post(
            f"/api/spaces/{_shared_space_id}/tasks/boards/"
            f"{_shared_board_id}/tasks",
            json={
                "title": f"Mixed task {uuid.uuid4().hex[:6]}",
                "column_id": _shared_board_default_column_id,
            },
            headers=self._headers,
            name="/api/spaces/:id/tasks/boards/:id/tasks [create]")
        if r.status_code == 200:
            task_id = r.json().get("id")
            if task_id:
                self._task_ids.append(task_id)

    @task(2)
    def list_wiki_pages(self):
        self.client.get(
            f"/api/spaces/{_shared_space_id}/wiki/pages",
            headers=self._headers,
            name="/api/spaces/:id/wiki/pages")

    @task(1)
    def list_calendar_events(self):
        self.client.get(
            f"/api/spaces/{_shared_space_id}/calendar/events"
            "?start=2026-01-01T00:00:00Z&end=2026-12-31T23:59:59Z",
            headers=self._headers,
            name="/api/spaces/:id/calendar/events")

    @task(1)
    def list_task_boards(self):
        self.client.get(
            f"/api/spaces/{_shared_space_id}/tasks/boards",
            headers=self._headers,
            name="/api/spaces/:id/tasks/boards")

    # --- Notifications + profile (10%) ---

    @task(2)
    def list_notifications(self):
        self.client.get("/api/notifications", headers=self._headers,
                        name="/api/notifications")

    @task(2)
    def get_user_profile(self):
        self.client.get("/api/users/me", headers=self._headers,
                        name="/api/users/me")

    # --- Search (10%) ---

    @task(2)
    def search_general(self):
        term = random.choice(["load", "test", "wiki", "task", "mixed"])
        self.client.get(f"/api/search?q={term}&type=messages&limit=20",
                        headers=self._headers,
                        name="/api/search")

    @task(2)
    def search_composite(self):
        term = random.choice(["load", "test", "wiki", "task", "mixed"])
        self.client.get(
            f"/api/search/composite?filters=channels:{term}&result_type=messages&limit=20",
            headers=self._headers,
            name="/api/search/composite")

    # --- File upload/download (5%) ---

    @task(1)
    def upload_small_file(self):
        size = 1024 * (1 + int(uuid.uuid4().int % 5))
        content = os.urandom(size)
        filename = f"mixed_{uuid.uuid4().hex[:8]}.bin"

        r = self.client.post(
            f"/api/spaces/{_shared_space_id}/files/upload"
            f"?filename={filename}&content_type=application/octet-stream",
            data=content,
            headers={**self._headers, "Content-Type": "application/octet-stream"},
            name="/api/spaces/:id/files/upload")

        if r.status_code == 200:
            file_id = r.json().get("id")
            if file_id:
                self._uploaded_file_ids.append(file_id)
                if len(self._uploaded_file_ids) > 20:
                    self._uploaded_file_ids = self._uploaded_file_ids[-10:]

    @task(1)
    def download_file(self):
        if not self._uploaded_file_ids:
            return
        file_id = random.choice(self._uploaded_file_ids)
        self.client.get(
            f"/api/spaces/{_shared_space_id}/files/{file_id}/download",
            headers=self._headers,
            name="/api/spaces/:id/files/:id/download")
