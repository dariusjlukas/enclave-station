# Object storage for horizontal file-storage scaling

## Overview

Uploaded file blobs (chat attachments, space files, wiki media, avatars, server
icons) are addressed by an opaque key (a 32-byte hex id) and stored through a
pluggable `StorageBackend`:

- **`local`** (default) — flat files under `UPLOAD_DIR`. Zero dependencies.
  Single-instance only: a local volume is not shared across replicas, so
  instance A's uploads are invisible to instance B.
- **`s3`** — an S3-compatible object store shared by every backend replica.
  Required for horizontal scaling.

The S3 backend speaks the S3 REST API with AWS Signature V4 signing (implemented
with OpenSSL — no AWS SDK), so it works with any S3-compatible store:
**MinIO**, **Garage**, **Ceph RADOS Gateway**, **OpenStack Swift** (s3api
middleware), AWS S3, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces.
None of these is required — local-first single-instance deployment is unchanged.

## Configuration

| Var | Meaning |
|-----|---------|
| `STORAGE_BACKEND` | `local` (default) or `s3`. |
| `S3_ENDPOINT` | Base URL, e.g. `http://minio:9000` or `https://s3.us-east-1.amazonaws.com`. |
| `S3_BUCKET` | Bucket name (must already exist). |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credentials. |
| `S3_REGION` | SigV4 region (default `us-east-1`; MinIO accepts any value). |

Path-style addressing (`endpoint/bucket/key`) is used, which is what
self-hosted stores expect.

On boot with `STORAGE_BACKEND=s3` the backend HEADs the bucket and **fails fast**
if it is unreachable or unauthorized, rather than starting and failing uploads
later.

## Quick start with the bundled MinIO

```sh
# .env
STORAGE_BACKEND=s3
S3_ENDPOINT=http://minio:9000
S3_BUCKET=enclave
S3_ACCESS_KEY=<choose>
S3_SECRET_KEY=<choose, e.g. openssl rand -hex 32>

docker compose --profile minio up -d
```

The `minio` profile also starts a one-shot `minio-init` container that creates
the bucket. The MinIO console is on `:9090`.

To use an external store instead, skip the profile and point `S3_ENDPOINT` at it.

## What is shared across instances

With `STORAGE_BACKEND=s3`, every blob read/write/delete goes to the shared
store, so **all downloads, single-shot uploads, avatars, icons, wiki media, and
the folder-zip download work from any instance** regardless of which instance
wrote the file.

## Chunked uploads — sticky-session requirement (current limitation)

Chunked uploads (`/upload/init` → `/chunk` × N → `/complete`) keep their
in-flight session state (the S3 multipart upload id + per-part ETags) **in the
process that received `init`**. The assembled final object lands in shared S3
and is then globally readable — but the init / chunk / complete requests of a
single upload must all reach the **same instance**.

Therefore, until the multipart session map is moved to a shared store
(planned follow-up), a multi-instance deployment must use **session affinity**
at the load balancer for the upload endpoints (or for all requests). With
nginx-ingress: `nginx.ingress.kubernetes.io/affinity: cookie`. Single-shot
uploads and all downloads do **not** need affinity.

## Rollout

1. Stand up the object store and create the bucket.
2. Set `STORAGE_BACKEND=s3` + `S3_*` on one backend; verify uploads/downloads
   and that objects appear in the bucket.
3. Scale out: point all replicas at the same bucket. Enable LB session affinity
   so chunked uploads stick to one instance.

> Migration note: switching an existing `local` deployment to `s3` does not copy
> existing files. Either start fresh, or copy `UPLOAD_DIR/*` into the bucket
> (flat keys, same names) before cutting over.
