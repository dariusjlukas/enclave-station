# Isle Chat

A self-hosted chat application with PKI-based authentication, multi-device support, and real-time messaging over WebSockets.

- **Backend**: C++ (uWebSockets, libpqxx, nlohmann/json)
- **Frontend**: React, TypeScript, Tailwind CSS
- **Database**: PostgreSQL 16
- **Proxy**: Nginx (serves frontend + proxies API/WebSocket to backend)

## Prerequisites

- Docker and Docker Compose

## Setup

1. Clone the repository and `cd` into it.

2. Copy the example environment file and edit it:

   ```
   cp .env.example .env
   ```

   At minimum, change `POSTGRES_PASSWORD` to something secure.

3. If you want other devices on your LAN to link via QR code, set `PUBLIC_URL` to your machine's LAN address:

   ```
   PUBLIC_URL=http://192.168.1.100
   ```

   If left blank, the QR code will use the browser's current origin (which is `localhost` when the admin is on the server machine).

4. Start the application:

   ```
   docker compose up -d --build
   ```

5. Open `http://localhost` in your browser. The first user to register becomes the admin.

## Configuration

All configuration is done through environment variables in `.env`:

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `chatapp` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `changeme_in_production` | PostgreSQL password |
| `POSTGRES_DB` | `chatapp` | PostgreSQL database name |
| `SESSION_EXPIRY_HOURS` | `168` (7 days) | How long login sessions last |
| `PUBLIC_URL` | *(empty)* | Public-facing URL for QR codes (e.g. `http://192.168.1.100`) |

## Usage

### Starting the server

```
docker compose up -d
```

Add `--build` if you've made code changes:

```
docker compose up -d --build
```

### Stopping the server

```
docker compose down
```

This stops all containers but preserves the database volume.

### Viewing logs

```
docker compose logs -f           # all services
docker compose logs -f backend   # backend only
docker compose logs -f frontend  # nginx/frontend only
docker compose logs -f postgres  # database only
```

### Resetting the database

To wipe all data (users, messages, channels) and start fresh:

```
docker compose down -v
docker compose up -d --build
```

The `-v` flag removes the PostgreSQL data volume. The next startup will run migrations and create a clean database. The first user to register will become admin again.

### Accessing from other devices

The server listens on port 80. Other devices on the same network can access it via your machine's IP address (e.g. `http://192.168.1.100`).

To find your machine's IP:

```
# Linux
hostname -I | awk '{print $1}'

# macOS
ipconfig getifaddr en0
```

### Multi-device account linking

1. Log in on your primary device
2. Click **Devices** in the header
3. Click **Link New Device**
4. On the new device, either:
   - Scan the QR code with the phone's camera, or
   - Open the app and click **Link existing account to this device**, then paste the token
5. Enter a device name and tap **Link Device**

## Architecture

```
Browser ──► Nginx (:80)
              ├── /           → serves React SPA
              ├── /api/*      → proxies to backend (:9001)
              └── /ws         → proxies WebSocket to backend (:9001)

Backend (:9001) ──► PostgreSQL (:5432)
```

Authentication uses Ed25519 keypairs stored in the browser's IndexedDB. No passwords are involved — each device holds a private key and the server stores the corresponding public key.
