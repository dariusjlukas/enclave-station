# Kubernetes / Helm deployment

Enclave Station ships a Helm chart at [`deploy/helm/enclave-station`](../../deploy/helm/enclave-station)
that deploys the full stack — backend, frontend, schema migrations, and
(optionally) in-cluster Postgres/Redis — and is built for horizontal scaling.

Because P0/P1 externalized all per-connection state (WebSocket fan-out via
Redis, chunked uploads via the database, blob storage via S3), backend pods are
stateless and interchangeable: **no session affinity is required at the
ingress**, and the backend scales freely under an HPA.

## Images

The chart references three images, all published by
[`.github/workflows/docker-publish.yml`](../../.github/workflows/docker-publish.yml)
on every `v*` tag:

| Image | Source | Role |
|-------|--------|------|
| `…/backend`     | [`backend/Dockerfile`](../../backend/Dockerfile)   | C++ API + WebSocket server (port 9001) |
| `…/frontend`    | [`frontend/Dockerfile`](../../frontend/Dockerfile) | nginx serving the built SPA (port 80) |
| `…/migrations`  | [`sqitch/Dockerfile`](../../sqitch/Dockerfile)     | sqitch project; applies the schema |

The `migrations` image bundles the canonical [`sqitch/`](../../sqitch) project so
the repo stays the single source of truth for schema — no SQL is duplicated into
the chart.

## What gets deployed

```
                 ┌────────────── Ingress (WS-aware) ──────────────┐
   client ──▶    │  /api ─▶ backend   /ws ─▶ backend   / ─▶ front │
                 └────────────────────────────────────────────────┘
                          │                         │
                  backend Deployment          frontend Deployment
                   (HPA, PDB, N pods)            (nginx, SPA)
                          │
        ┌─────────────────┼───────────────────┐
   PostgreSQL          Redis pub/sub      S3 object store
   (schema via         (cross-instance    (shared blobs;
    migration Job)      WS fan-out)        chunked uploads)
```

- **Migration Job** — a Helm `pre-install`/`pre-upgrade` hook runs
  `sqitch deploy --verify` before backend pods roll. It is idempotent (an
  up-to-date database is a no-op), so re-running on every upgrade is safe. The
  backend runs with `ENABLE_SQITCH_ONLY=1` and never self-migrates.
- **Ingress** — routes `/api` and `/ws` to the backend and `/` to the frontend.
  Long proxy timeouts keep persistent WebSockets and large uploads alive.
  `/metrics` is **not** exposed publicly (scrape the backend Service in-cluster
  via the optional `ServiceMonitor`).
- **HPA + PodDisruptionBudget** — CPU/memory autoscaling with a scale-down
  stabilization window so transient dips don't churn pods and drop WS
  connections; the PDB keeps a minimum number of pods up during node drains.
- **`INSTANCE_ID`** — injected from the pod name via the downward API, so each
  pod filters its own echoes off the shared Redis broadcast channel.

## Quick start (single-node eval)

Brings up everything in-cluster on k3s/kind/minikube — Postgres, Redis, and
local-filesystem uploads. **Not production grade.**

```bash
# Build/pull the three images, then:
helm install enclave deploy/helm/enclave-station \
  -f deploy/helm/enclave-station/ci/eval-values.yaml \
  --namespace enclave --create-namespace

# Reach the app (ingress is off in the eval preset):
kubectl -n enclave port-forward svc/enclave-enclave-station-frontend 8080:80
# open http://localhost:8080
```

## Production deployment

Use external Postgres, Redis, and S3, and let the backend autoscale. Start from
[`ci/production-values.yaml`](../../deploy/helm/enclave-station/ci/production-values.yaml):

```bash
helm install enclave \
  oci://ghcr.io/dariusjlukas/enclave-station/charts/enclave-station \
  --version 0.1.0 \
  -f my-production-values.yaml \
  --namespace enclave --create-namespace
```

### Required production values

| Value | Notes |
|-------|-------|
| `publicUrl` | External origin (e.g. `https://chat.example.com`). Drives the WebAuthn RP ID/origin — changing the host after passkeys are registered invalidates them. |
| `ingress.host` | Must match `publicUrl`'s host. |
| `postgresql.host` / `…username` / `…database` | External Postgres connection. |
| `postgresql.password` | Or supply `auth.existingSecret` (see below). |
| `redis.url` | `redis://` or `rediss://…` (AUTH/TLS supported — see [redis-pubsub.md](./redis-pubsub.md)). **Required** when running more than one backend replica. |
| `storage.backend: s3` + `storage.s3.*` | Shared blob store — **required** for horizontal scaling. See [object-storage.md](./object-storage.md). The backend fails fast at boot if S3 is unreachable. |

### Managing secrets yourself

By default the chart creates a Secret from the password/key values. To use
sealed-secrets, external-secrets, or Vault instead, set `auth.existingSecret` to
a Secret that contains these keys (any unused key may be omitted):

```
postgres-password   s3-access-key   s3-secret-key   redis-url
```

## Scaling rules (read before turning on the HPA)

Horizontal scaling needs **shared** state across pods:

1. **Redis is required** for more than one replica — otherwise clients on
   different pods can't see each other's messages. The chart's `NOTES.txt`
   warns if `replicaCount > 1` without Redis.
2. **Blob storage must be shared** — either `storage.backend: s3` (recommended)
   or `storage.backend: local` on a **ReadWriteMany** volume. The default
   ReadWriteOnce local volume only supports a single replica; the HPA will warn.

## Upgrades

```bash
helm upgrade enclave … -f my-production-values.yaml
```

On upgrade the migration hook re-runs `sqitch deploy --verify` (no-op if already
current), then the backend performs a zero-downtime rolling update
(`maxUnavailable: 0`). Disconnected WebSocket clients reconnect to another pod;
cross-instance Redis fan-out keeps delivery intact across the roll.

## Observability

Set `serviceMonitor.enabled: true` (requires the Prometheus Operator CRDs) to
scrape the backend `/metrics` endpoint in-cluster. The public ingress never
exposes `/metrics`.
