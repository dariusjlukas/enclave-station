"""Test data seeding utilities for load test scenarios.

All functions use the HTTP API to create data. Works with both
Locust's HttpSession and plain requests.Session via the _post/_put/_get
wrappers in helpers.auth.
"""

import uuid

from helpers.auth import _get, _post, _put, auth_header


def create_public_channel(client, token, name=None):
    """Create a public channel and return its data."""
    if name is None:
        name = f"load-ch-{uuid.uuid4().hex[:8]}"
    headers = auth_header(token)
    r = _post(client, "/api/channels", json={
        "name": name,
        "is_public": True,
    }, headers=headers, name="/api/channels [setup]")
    r.raise_for_status()
    return r.json()


def join_channel(client, token, channel_id):
    """Join a public channel."""
    headers = auth_header(token)
    r = _post(client, f"/api/channels/{channel_id}/join",
              headers=headers,
              name="/api/channels/:id/join [setup]")
    r.raise_for_status()
    return r.json()


def create_space(client, token, name=None):
    """Create a space and return its data.

    Sets default_role to 'admin' so that joining users can create
    tasks, upload files, and edit wiki/calendar.
    """
    if name is None:
        name = f"Load Space {uuid.uuid4().hex[:8]}"
    headers = auth_header(token)
    r = _post(client, "/api/spaces", json={
        "name": name,
        "description": "Load test space",
        "is_public": True,
        "default_role": "admin",
    }, headers=headers, name="/api/spaces [setup]")
    r.raise_for_status()
    return r.json()


def join_space(client, token, space_id):
    """Join a public space."""
    headers = auth_header(token)
    r = _post(client, f"/api/spaces/{space_id}/join",
              headers=headers,
              name="/api/spaces/:id/join [setup]")
    r.raise_for_status()
    return r.json()


def enable_space_tools(client, token, space_id):
    """Enable all tools on a space (one request per tool)."""
    headers = auth_header(token)
    for tool in ("tasks", "wiki", "files", "calendar"):
        r = _put(client, f"/api/spaces/{space_id}/tools", json={
            "tool": tool,
            "enabled": True,
        }, headers=headers, name="/api/spaces/:id/tools [setup]")
        r.raise_for_status()
    return r.json()


def create_task_board(client, token, space_id, name=None):
    """Create a task board in a space."""
    if name is None:
        name = f"Board {uuid.uuid4().hex[:6]}"
    headers = auth_header(token)
    r = _post(client, f"/api/spaces/{space_id}/tasks/boards", json={
        "name": name,
    }, headers=headers, name="/api/spaces/:id/tasks/boards [setup]")
    r.raise_for_status()
    return r.json()


def create_task(client, token, space_id, board_id, column_id, title=None):
    """Create a task on a board."""
    if title is None:
        title = f"Task {uuid.uuid4().hex[:6]}"
    headers = auth_header(token)
    r = _post(client, f"/api/spaces/{space_id}/tasks/boards/{board_id}/tasks",
              json={
                  "title": title,
                  "column_id": column_id,
              }, headers=headers,
              name="/api/spaces/:id/tasks/boards/:id/tasks [setup]")
    r.raise_for_status()
    return r.json()


def create_wiki_page(client, token, space_id, title=None, content=None):
    """Create a wiki page in a space."""
    if title is None:
        title = f"Wiki {uuid.uuid4().hex[:6]}"
    if content is None:
        content = f"Load test wiki content {uuid.uuid4().hex}"
    headers = auth_header(token)
    r = _post(client, f"/api/spaces/{space_id}/wiki/pages", json={
        "title": title,
        "content": content,
    }, headers=headers, name="/api/spaces/:id/wiki/pages [setup]")
    r.raise_for_status()
    return r.json()


def create_calendar_event(client, token, space_id, title=None):
    """Create a calendar event in a space."""
    if title is None:
        title = f"Event {uuid.uuid4().hex[:6]}"
    headers = auth_header(token)
    r = _post(client, f"/api/spaces/{space_id}/calendar/events", json={
        "title": title,
        "start_time": "2026-04-01T10:00:00Z",
        "end_time": "2026-04-01T11:00:00Z",
    }, headers=headers, name="/api/spaces/:id/calendar/events [setup]")
    r.raise_for_status()
    return r.json()
