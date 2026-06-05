# enclave-station Helm chart

Deploys [Enclave Station](https://github.com/dariusjlukas/enclave-station) — a
self-hosted team collaboration platform — to Kubernetes. Backend pods are
stateless and horizontally scalable (WebSocket fan-out via Redis, chunked
uploads via the database, blob storage via S3), so the ingress needs **no
session affinity** and the backend runs under an HPA.

Full operator guide: [`docs/ops/kubernetes.md`](../../../docs/ops/kubernetes.md).

## TL;DR

```bash
# Single-node eval (in-cluster Postgres + Redis + local uploads):
helm install enclave . -f ci/eval-values.yaml -n enclave --create-namespace

# Production (external Postgres + Redis + S3, autoscaled):
helm install enclave oci://ghcr.io/dariusjlukas/enclave-station/charts/enclave-station \
  --version 0.1.0 -f my-values.yaml -n enclave --create-namespace
```

## What it deploys

- **backend** Deployment + Service + HPA + PodDisruptionBudget
- **frontend** Deployment + Service (nginx SPA)
- **migration** Job — `sqitch deploy --verify` as a pre-install/pre-upgrade hook
- **Ingress** — WS-aware (`/api`, `/ws` → backend; `/` → frontend)
- optional **ConfigMap/Secret**, **ServiceMonitor**, and eval-only in-cluster
  **PostgreSQL** (StatefulSet) and **Redis**

## Key values

| Value | Default | Purpose |
|-------|---------|---------|
| `publicUrl` | `https://chat.example.com` | External origin; drives WebAuthn RP. |
| `backend.autoscaling.enabled` | `true` | HPA on the backend. |
| `storage.backend` | `s3` | `s3` (scalable) or `local` (PVC). |
| `postgresql.deploy` / `redis.deploy` | `false` | In-cluster datastores (eval only). |
| `redis.url` | `""` | External Redis; required for >1 replica. |
| `ingress.enabled` | `true` | WS-aware ingress. |
| `auth.existingSecret` | `""` | Bring your own Secret instead of chart-managed. |

See [`values.yaml`](./values.yaml) for the full, commented set, and the
[`ci/`](./ci) directory for the `eval` and `production` presets.
