"""Scenario 5: Search under load.

Tests search performance with concurrent queries across messages,
files, users, channels, spaces, and wiki pages.
"""

import random

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
    create_public_channel,
    create_space,
    create_wiki_page,
    enable_space_tools,
    join_channel,
    join_space,
)

# One-time scenario setup
_setup_lock = gevent.lock.Semaphore()
_scenario_setup_done = False
_shared_channel_id = None
_shared_space_id = None

_SEARCH_TERMS = [
    "load", "test", "performance", "wiki", "task",
    "meeting", "update", "review", "deploy", "config",
]


def _ensure_scenario_setup(client):
    global _scenario_setup_done
    global _shared_channel_id, _shared_space_id

    admin = ensure_admin_setup(client)
    admin_token = admin["token"]

    with _setup_lock:
        if _scenario_setup_done:
            return

        ch = create_public_channel(client, admin_token, "load-search")
        _shared_channel_id = ch["id"]

        sp = create_space(client, admin_token, "Load Search Space")
        _shared_space_id = sp["id"]
        enable_space_tools(client, admin_token, _shared_space_id)

        for term in _SEARCH_TERMS:
            create_wiki_page(
                client, admin_token, _shared_space_id,
                title=f"Guide: {term} procedures",
                content=f"Detailed documentation about {term} "
                        f"processes and best practices for the team.")

        _scenario_setup_done = True


class SearchUser(HttpUser):
    """Simulates users performing searches across the platform."""

    wait_time = between(0.5, 2)

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

    def _random_term(self):
        return random.choice(_SEARCH_TERMS)

    @task(4)
    def search_messages(self):
        """Search messages."""
        term = self._random_term()
        self.client.get(
            f"/api/search?q={term}&type=messages&limit=20",
            headers=self._headers,
            name="/api/search [messages]")

    @task(3)
    def search_composite(self):
        """Advanced composite search with filters."""
        term = self._random_term()
        self.client.get(
            f"/api/search/composite?filters=channels:{term}&result_type=messages&limit=20",
            headers=self._headers,
            name="/api/search/composite")

    @task(2)
    def search_with_type_filter(self):
        """Search filtered by type."""
        term = self._random_term()
        search_type = random.choice(["messages", "files", "users",
                                     "channels", "wiki", "spaces"])
        self.client.get(
            f"/api/search?q={term}&type={search_type}&limit=20",
            headers=self._headers,
            name=f"/api/search [{search_type}]")

    @task(1)
    def list_channel_messages(self):
        """Fetch recent messages (simulates scrolling/browsing)."""
        self.client.get(
            f"/api/channels/{_shared_channel_id}/messages?limit=50",
            headers=self._headers,
            name="/api/channels/:id/messages")
