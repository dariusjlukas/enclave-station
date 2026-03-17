"""Scenario 2: Channel messaging via WebSocket.

Measures real-time messaging throughput and latency under concurrent
WebSocket connections. Each Locust user opens a persistent WS connection
and sends/receives messages in a shared channel.
"""

import logging

import gevent
from locust import HttpUser, between, task

from helpers.auth import (
    PKIIdentity,
    auth_header,
    ensure_admin_setup,
    pki_register,
    unique_username,
)
from helpers.data_setup import create_public_channel, join_channel
from helpers.ws_client import LocustWebSocket

logger = logging.getLogger(__name__)

# Shared channel coordinated via gevent lock
_channel_lock = gevent.lock.Semaphore()
_shared_channel_id = None


def _ensure_channel(client, admin_token):
    """Create the shared messaging channel once."""
    global _shared_channel_id

    with _channel_lock:
        if _shared_channel_id is not None:
            return

        ch = create_public_channel(client, admin_token, "load-messaging")
        _shared_channel_id = ch["id"]


class MessagingUser(HttpUser):
    """Simulates a user sending and receiving chat messages via WebSocket.

    Extends HttpUser so Locust's self.client (HttpSession) is available
    for the HTTP setup calls. The WebSocket connection is managed separately.
    """

    wait_time = between(0.2, 1.0)

    def on_start(self):
        admin = ensure_admin_setup(self.client)
        _ensure_channel(self.client, admin["token"])

        # Register this user
        self._identity = PKIIdentity()
        username = unique_username()
        data = pki_register(self.client, username, f"User {username}",
                            self._identity)
        self._token = data["token"]
        self._headers = auth_header(self._token)

        # Join the shared channel
        join_channel(self.client, self._token, _shared_channel_id)

        # Open WebSocket connection
        host = self.environment.host
        ws_url = host.replace("http://", "ws://").replace("https://", "wss://")
        self._ws = LocustWebSocket(self.environment)
        self._ws.connect(f"{ws_url}/ws?token={self._token}")

    def on_stop(self):
        if hasattr(self, "_ws") and self._ws:
            logger.info(
                "MessagingUser stats: sent=%d received=%d",
                self._ws.messages_sent,
                self._ws.messages_received,
            )
            self._ws.close()

    @task(5)
    def send_chat_message(self):
        """Send a message to the shared channel."""
        self._ws.send_message(_shared_channel_id)

    @task(3)
    def send_typing(self):
        """Send a typing indicator."""
        self._ws.send_typing(_shared_channel_id)

    @task(2)
    def mark_read(self):
        """Mark the channel as read up to the latest message."""
        self._ws.mark_read(_shared_channel_id)

    @task(1)
    def add_reaction(self):
        """React to the most recent message."""
        self._ws.add_reaction(None, "👍")

    @task(1)
    def ws_ping(self):
        """Send a ping to measure WS round-trip."""
        self._ws.ping()
