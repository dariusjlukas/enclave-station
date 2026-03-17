"""Scenario 3: REST API CRUD mix.

Exercises the full breadth of HTTP endpoints under load, simulating
realistic API usage patterns across channels, spaces, tasks, wiki,
calendar, and notifications.
"""

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

# One-time scenario-specific setup (channels, spaces, boards)
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

        ch = create_public_channel(client, admin_token, "load-rest")
        _shared_channel_id = ch["id"]

        sp = create_space(client, admin_token, "Load REST Space")
        _shared_space_id = sp["id"]
        enable_space_tools(client, admin_token, _shared_space_id)

        board = create_task_board(client, admin_token, _shared_space_id)
        _shared_board_id = board["id"]

        r = client.get(
            f"/api/spaces/{_shared_space_id}/tasks/boards/{_shared_board_id}",
            headers=headers,
            name="/api/spaces/:id/tasks/boards/:id [setup]")
        if r.status_code == 200:
            board_data = r.json()
            columns = board_data.get("columns", [])
            if columns:
                _shared_board_default_column_id = columns[0]["id"]

        for i in range(3):
            create_wiki_page(client, admin_token, _shared_space_id,
                             f"Load Wiki {i}")
            create_calendar_event(client, admin_token, _shared_space_id,
                                  f"Load Event {i}")

        _scenario_setup_done = True


class RestApiMixUser(HttpUser):
    """Simulates a user performing mixed REST API operations."""

    wait_time = between(0.5, 2)

    def on_start(self):
        _ensure_scenario_setup(self.client)

        self._identity = PKIIdentity()
        username = unique_username()
        data = pki_register(self.client, username, f"User {username}",
                            self._identity)
        self._token = data["token"]
        self._headers = auth_header(self._token)
        self._user_id = data["user"]["id"]

        join_channel(self.client, self._token, _shared_channel_id)
        join_space(self.client, self._token, _shared_space_id)

        self._task_ids = []
        self._wiki_page_ids = []

    @task(5)
    def list_channels(self):
        self.client.get("/api/channels", headers=self._headers,
                        name="/api/channels")

    @task(5)
    def get_channel_messages(self):
        self.client.get(
            f"/api/channels/{_shared_channel_id}/messages?limit=50",
            headers=self._headers,
            name="/api/channels/:id/messages")

    @task(3)
    def list_spaces(self):
        self.client.get("/api/spaces", headers=self._headers,
                        name="/api/spaces")

    @task(3)
    def get_space_details(self):
        self.client.get(f"/api/spaces/{_shared_space_id}",
                        headers=self._headers,
                        name="/api/spaces/:id")

    @task(2)
    def list_task_boards(self):
        self.client.get(
            f"/api/spaces/{_shared_space_id}/tasks/boards",
            headers=self._headers,
            name="/api/spaces/:id/tasks/boards")

    @task(1)
    def create_and_update_task(self):
        if not _shared_board_default_column_id:
            return

        r = self.client.post(
            f"/api/spaces/{_shared_space_id}/tasks/boards/{_shared_board_id}/tasks",
            json={
                "title": f"Load task {uuid.uuid4().hex[:6]}",
                "column_id": _shared_board_default_column_id,
            },
            headers=self._headers,
            name="/api/spaces/:id/tasks/boards/:id/tasks [create]")

        if r.status_code == 200:
            task_data = r.json()
            task_id = task_data.get("id")
            if task_id:
                self._task_ids.append(task_id)

                self.client.put(
                    f"/api/spaces/{_shared_space_id}/tasks/boards/"
                    f"{_shared_board_id}/tasks/{task_id}",
                    json={"title": f"Updated {uuid.uuid4().hex[:6]}"},
                    headers=self._headers,
                    name="/api/spaces/:id/tasks/boards/:id/tasks/:id [update]")

    @task(2)
    def list_wiki_pages(self):
        self.client.get(
            f"/api/spaces/{_shared_space_id}/wiki/pages",
            headers=self._headers,
            name="/api/spaces/:id/wiki/pages")

    @task(1)
    def create_wiki_page(self):
        r = self.client.post(
            f"/api/spaces/{_shared_space_id}/wiki/pages",
            json={
                "title": f"Load Wiki {uuid.uuid4().hex[:6]}",
                "content": "Performance test wiki content.",
            },
            headers=self._headers,
            name="/api/spaces/:id/wiki/pages [create]")

        if r.status_code == 200:
            page = r.json()
            page_id = page.get("id")
            if page_id:
                self._wiki_page_ids.append(page_id)

    @task(1)
    def update_wiki_page(self):
        if not self._wiki_page_ids:
            return
        page_id = self._wiki_page_ids[-1]
        self.client.put(
            f"/api/spaces/{_shared_space_id}/wiki/pages/{page_id}",
            json={"content": f"Updated content {uuid.uuid4().hex[:8]}"},
            headers=self._headers,
            name="/api/spaces/:id/wiki/pages/:id [update]")

    @task(2)
    def list_calendar_events(self):
        self.client.get(
            f"/api/spaces/{_shared_space_id}/calendar/events"
            "?start=2026-01-01T00:00:00Z&end=2026-12-31T23:59:59Z",
            headers=self._headers,
            name="/api/spaces/:id/calendar/events")

    @task(1)
    def create_calendar_event(self):
        self.client.post(
            f"/api/spaces/{_shared_space_id}/calendar/events",
            json={
                "title": f"Load Event {uuid.uuid4().hex[:6]}",
                "start_time": "2026-04-01T10:00:00Z",
                "end_time": "2026-04-01T11:00:00Z",
            },
            headers=self._headers,
            name="/api/spaces/:id/calendar/events [create]")

    @task(2)
    def list_notifications(self):
        self.client.get("/api/notifications", headers=self._headers,
                        name="/api/notifications")

    @task(2)
    def get_user_profile(self):
        self.client.get("/api/users/me", headers=self._headers,
                        name="/api/users/me")

    @task(1)
    def list_users(self):
        self.client.get("/api/users", headers=self._headers,
                        name="/api/users")

    @task(1)
    def search(self):
        self.client.get("/api/search?q=load&type=messages&limit=20",
                        headers=self._headers,
                        name="/api/search")
