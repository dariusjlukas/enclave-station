"""gevent-compatible WebSocket client wrapper with Locust metrics integration.

Uses websocket-client (not the asyncio-based websockets library) because
Locust runs on gevent.
"""

import json
import time
import uuid

import gevent
import websocket


class LocustWebSocket:
    """WebSocket client that reports metrics to Locust's event system.

    Usage:
        ws = LocustWebSocket(environment)
        ws.connect("ws://localhost:9001/ws?token=SESSION_TOKEN")
        ws.send_message(channel_id, "Hello!")
        ws.close()
    """

    def __init__(self, environment):
        self.environment = environment
        self.ws = None
        self._connected = False
        self._receiver_greenlet = None
        self._pinger_greenlet = None

        # Incoming message queue for correlation
        self._received_messages = {}  # correlation_id -> timestamp
        self._pending_sends = {}  # correlation_id -> send_timestamp
        self._last_received_message_id = None
        self._last_received_message_ts = None

        # Counters for correctness tracking
        self.messages_sent = 0
        self.messages_received = 0

    def connect(self, url):
        """Connect to the WebSocket server and start the receiver greenlet."""
        start = time.time()
        try:
            self.ws = websocket.create_connection(
                url,
                timeout=10,
                enable_multithread=True,
            )
            self._connected = True
            elapsed_ms = (time.time() - start) * 1000

            self.environment.events.request.fire(
                request_type="WSConnect",
                name="/ws [connect]",
                response_time=elapsed_ms,
                response_length=0,
                exception=None,
                context={},
            )

            # Start background receiver
            self._receiver_greenlet = gevent.spawn(self._receive_loop)
            # Start periodic ping to keep alive (server idle timeout is 120s)
            self._pinger_greenlet = gevent.spawn(self._ping_loop)

            # Wait briefly for initial server messages (unread_counts, etc.)
            gevent.sleep(0.5)

        except Exception as e:
            elapsed_ms = (time.time() - start) * 1000
            self.environment.events.request.fire(
                request_type="WSConnect",
                name="/ws [connect]",
                response_time=elapsed_ms,
                response_length=0,
                exception=e,
                context={},
            )
            raise

    def close(self):
        """Close the WebSocket connection and stop background greenlets."""
        self._connected = False
        if self._receiver_greenlet:
            self._receiver_greenlet.kill(block=False)
        if self._pinger_greenlet:
            self._pinger_greenlet.kill(block=False)
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass

    def send_message(self, channel_id, content=None):
        """Send a chat message. Embeds a correlation UUID for round-trip tracking."""
        correlation_id = uuid.uuid4().hex[:16]
        if content is None:
            content = f"load test msg {correlation_id}"
        else:
            content = f"{content} [{correlation_id}]"

        payload = json.dumps({
            "type": "send_message",
            "channel_id": channel_id,
            "content": content,
        })

        self._pending_sends[correlation_id] = time.time()
        self.messages_sent += 1
        self._send(payload, "WSSend", "/ws send_message")

    def send_typing(self, channel_id):
        """Send a typing indicator."""
        payload = json.dumps({
            "type": "typing",
            "channel_id": channel_id,
        })
        self._send(payload, "WSSend", "/ws typing")

    def mark_read(self, channel_id, message_id=None, timestamp=None):
        """Mark a channel as read up to the given message."""
        if message_id is None:
            message_id = self._last_received_message_id
        if message_id is None:
            return  # Nothing to mark

        if timestamp is None:
            timestamp = self._last_received_message_ts or \
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        payload = json.dumps({
            "type": "mark_read",
            "channel_id": channel_id,
            "message_id": message_id,
            "timestamp": timestamp,
        })
        self._send(payload, "WSSend", "/ws mark_read")

    def add_reaction(self, message_id, emoji="👍"):
        """Add a reaction to a message."""
        if message_id is None:
            message_id = self._last_received_message_id
        if message_id is None:
            return

        payload = json.dumps({
            "type": "add_reaction",
            "message_id": message_id,
            "emoji": emoji,
        })
        self._send(payload, "WSSend", "/ws add_reaction")

    def ping(self):
        """Send a ping and measure round-trip to pong."""
        payload = json.dumps({"type": "ping"})
        self._send(payload, "WSSend", "/ws ping")

    def _send(self, payload, request_type, name):
        """Send a payload and report to Locust."""
        start = time.time()
        try:
            self.ws.send(payload)
            elapsed_ms = (time.time() - start) * 1000
            self.environment.events.request.fire(
                request_type=request_type,
                name=name,
                response_time=elapsed_ms,
                response_length=len(payload),
                exception=None,
                context={},
            )
        except Exception as e:
            elapsed_ms = (time.time() - start) * 1000
            self.environment.events.request.fire(
                request_type=request_type,
                name=name,
                response_time=elapsed_ms,
                response_length=0,
                exception=e,
                context={},
            )

    def _receive_loop(self):
        """Background greenlet that processes incoming WebSocket messages."""
        while self._connected:
            try:
                raw = self.ws.recv()
                if not raw:
                    continue

                msg = json.loads(raw)
                msg_type = msg.get("type", "")

                if msg_type == "new_message":
                    self.messages_received += 1
                    message = msg.get("message", {})
                    self._last_received_message_id = message.get("id")
                    self._last_received_message_ts = message.get("created_at")

                    # Check for correlation ID in content
                    content = message.get("content", "")
                    for cid, send_time in list(self._pending_sends.items()):
                        if cid in content:
                            rtt_ms = (time.time() - send_time) * 1000
                            self.environment.events.request.fire(
                                request_type="WSRoundTrip",
                                name="/ws message_roundtrip",
                                response_time=rtt_ms,
                                response_length=len(raw),
                                exception=None,
                                context={},
                            )
                            del self._pending_sends[cid]
                            break

                elif msg_type == "pong":
                    # pong is handled implicitly — the send already recorded
                    pass

                elif msg_type == "error":
                    self.environment.events.request.fire(
                        request_type="WSRecv",
                        name="/ws error",
                        response_time=0,
                        response_length=len(raw),
                        exception=Exception(msg.get("message", "unknown")),
                        context={},
                    )

                # Other message types (typing, read_receipt, user_online, etc.)
                # are expected and silently consumed.

            except websocket.WebSocketConnectionClosedException:
                break
            except Exception:
                if not self._connected:
                    break
                gevent.sleep(0.1)

    def _ping_loop(self):
        """Send periodic pings to keep the connection alive."""
        while self._connected:
            gevent.sleep(30)
            if self._connected and self.ws:
                try:
                    self.ws.send(json.dumps({"type": "ping"}))
                except Exception:
                    break
