# Hostinger VPS Deployment — Design

**Date:** 2026-07-22
**Status:** Approved for planning
**Target:** `https://surfgen.io` on Hostinger VPS `srv1613644.hstgr.cloud` (76.13.44.91)

## Goal

Run the SurfGen stack in Docker on the user's existing Hostinger VPS, served over HTTPS at
`surfgen.io`, alongside the projects already on that box, with the core product loop
(signup → login → create → render → play back) working end to end.

## Environment (verified 2026-07-22)

### VPS

| Property | Value |
| --- | --- |
| ID / hostname | `1613644` / `srv1613644.hstgr.cloud` |
| Plan | KVM 2 — 2 vCPU, 8 GB RAM, 100 GB disk |
| Template | Ubuntu 24.04 with Docker and Traefik |
| IPv4 / IPv6 | `76.13.44.91` / `2a02:4780:28:7d22::1` |
| Utilisation | CPU ~0.5 %, RAM 1.1 / 8 GB, disk 58 / 100 GB |

Headroom is sufficient: ~6.8 GB RAM and ~44 GB disk free.

### Co-tenant projects (must not be disturbed)

| Project | State | Notes |
| --- | --- | --- |
| `traefik` | running | `network_mode: host`, owns :80/:443 |
| `aso-website` | running | behind Traefik |
| `bedrock` | running | behind Traefik; claims `bedrock.asointelligence.com` **and** `srv1613644.hstgr.cloud` |
| `postgresql-u6ju` | running | postgres:17, publishes `0.0.0.0:32768` |
| excalidraw, ollama, open-webui, mariadb, phpmyadmin, paperclip, hermes-agent | stopped | reclaimable disk |

### Existing Traefik configuration

Read from the live `traefik` project. SurfGen must conform to it rather than introduce a
second proxy:

- `network_mode: host` — Traefik shares the host network stack.
- `--providers.docker=true` with `--providers.docker.exposedbydefault=false` — discovery is
  by container label; containers are invisible to Traefik unless they opt in.
- Entrypoints: `web` (:80), `websecure` (:443).
- Cert resolver: **`letsencrypt`**, HTTP-01 challenge on the `web` entrypoint,
  ACME email `yahayababaganamn2@gmail.com`.
- Global HTTP→HTTPS redirect is already configured; SurfGen must not redeclare it.

Because Traefik is on the host network, it reaches containers at their bridge IPs directly.
**No shared external proxy network is required** — this is confirmed by `bedrock`, which
declares no `networks:` block at all and is routed successfully via labels alone.

### Domain

`surfgen.io` is registered at **Namecheap** (created 2026-07-04, expires 2028-07-04) but its
nameservers are delegated to Hostinger (`solar/lunar.dns-parking.com`), so the zone **is**
manageable through the Hostinger DNS API.

Current zone:

| Type | Name | Content | TTL |
| --- | --- | --- | --- |
| A | `@` | `2.57.91.91` (Hostinger parking) | 50 |
| CNAME | `www` | `surfgen.io.` | 300 |

## Design

### 1. Routing — single origin, path-based

All traffic on `https://surfgen.io`. The API's URL surface is cleanly namespaced
(`enableVersioning({ type: VersioningType.URI, prefix: 'v' })` in `apps/api/src/main.ts:37`),
and the web app's top-level routes (`/`, `/login`, `/signup`, `/verify-email`, and the
`(studio)` group) do not collide with any API path. Serving both from one origin removes
CORS and cross-origin cookie handling entirely.

Traefik routers, one per hostname (mirroring `bedrock`, so a pending DNS record for one
hostname cannot block certificate issuance for the other):

| Router | Rule | Priority | Target |
| --- | --- | --- | --- |
| `surfgen-api` | ``Host(`surfgen.io`) && (PathPrefix(`/v1`) \|\| PathPrefix(`/ws`) \|\| PathPrefix(`/docs`) \|\| Path(`/healthz`) \|\| Path(`/readyz`))`` | 100 | `api:4000` |
| `surfgen-web` | ``Host(`surfgen.io`)`` | 1 | `web:3000` |
| `surfgen-www` | ``Host(`www.surfgen.io`)`` | 1 | redirect → `https://surfgen.io` |

Explicit priorities are set rather than relying on Traefik's rule-length heuristic.

`/metrics` is deliberately **not** routed. It remains reachable only from inside the Docker
network.

`srv1613644.hstgr.cloud` must **not** be claimed — `bedrock` already owns it.

### 2. Services

`postgres:16-alpine`, `redis:7-alpine`, `rabbitmq:3.13-management-alpine`, `migrate`
(one-shot), `api`, `worker` (**1** replica, down from 2, for 2 vCPUs), `web`.

**No `ports:` are published for any service.** Traefik reaches `api` and `web` over the
bridge network; Postgres, Redis and RabbitMQ are consequently unreachable from the internet.
This also avoids a host-port collision with `bedrock` on :3000, and avoids the current
compose file's incidental exposure of the RabbitMQ management UI (:15672) and MinIO console
(:9001).

Only `api` and `web` carry `traefik.enable=true`.

### 3. Storage — `local` driver with a shared volume

**Decision: use the `local` storage driver and drop MinIO + `createbucket`.**

Rationale. `S3Storage.signedUrl()` (`packages/storage/src/s3-storage.ts:162`) presigns
against the configured S3 endpoint, and the current compose sets
`SURFGEN_STORAGE__ENDPOINT=http://minio:9000`. Presigned SigV4 URLs embed that host, so every
playback URL handed to a browser would point at `http://minio:9000/...` — unresolvable from
a user's machine. The `cdn.baseUrl` config key that would allow rewriting the host is
declared in `packages/config/src/schemas.ts:115` but is referenced nowhere in the codebase,
so nothing performs that rewrite. Shipping the s3 driver as configured would therefore break
video playback.

The `local` driver has no such problem: `LocalStorage.signedUrl()` returns an HMAC-signed
link to the API's `GET /v1/media` endpoint (`apps/api/src/media/media.controller.ts:25`),
which is already public via Traefik.

Implementation:

- Do **not** set `SURFGEN_STORAGE__*` overrides — `config/storage.yaml` already defaults to
  `driver: local`, `rootDir: ./storage/local`.
- Named volume `surfgen_media` mounted at `/app/storage/local` in **both** `api` and `worker`
  (the worker renders the bytes; the API serves them).
- `PUBLIC_API_URL=https://surfgen.io` in the API environment — this feeds `publicBaseUrl` in
  `apps/api/src/common/storage.provider.ts`.
- `JWT_SECRET` must be **identical** in `api` and `worker`: the media signing key is
  `sha256("media:" + JWT_SECRET)` (`apps/api/src/common/jwt-secret.ts:22`).

Verified safe: the worker constructs `LocalStorage` without media options
(`apps/workers/pipeline/src/main.ts:59`) and never calls `signedUrl()` in production code, so
only the API mints playback URLs.

Consequences: −2 containers, ~300 MB RAM saved, no additional public surface. The trade-off
is that media streams through the API process and storage is node-local — acceptable on a
single VPS, and revisitable if the deployment ever spans nodes.

### 4. Build hygiene — `.dockerignore`

Both Dockerfiles use `COPY . .`, and **no `.dockerignore` exists**. The build context is
currently **1.6 GB** (1.1 GB `node_modules`, 215 MB `.turbo`, a 732 KB archive).

Two problems follow. First, the entire context is tarred and sent to the Docker daemon before
any build step runs — minutes of pure overhead per build on 2 vCPUs. Second and more serious:
Docker does not honour `.gitignore`, only `.dockerignore`. Compose reads its `.env` from the
project directory, so a populated `.env` sitting next to the compose file would be baked into
an image layer by `COPY . .`, embedding `JWT_SECRET`, `POSTGRES_PASSWORD`,
`SURFGEN_ENCRYPTION_KEY` and the Paystack secret into the image — recoverable even if a later
layer deletes the file.

A `.dockerignore` is therefore a **required deliverable**, excluding at minimum:
`node_modules`, `.git`, `.turbo`, `.next`, `.env*`, `*.zip`, `storage/`, `coverage/`,
`apps/web/e2e` artifacts, `**/dist`, `**/.venv`.

### 5. Secrets

Generated on the VPS into `/docker/surfgen/.env`, `chmod 600`, never committed:

| Variable | Generation |
| --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -base64 24` |
| `RABBITMQ_PASSWORD` | `openssl rand -base64 24` |
| `JWT_SECRET` | `openssl rand -base64 32` |
| `SURFGEN_ENCRYPTION_KEY` | 32 bytes — AES-256-GCM key for the Paystack secret box |
| `SEED_ADMIN_PASSWORD` | `openssl rand -base64 18` |

Paystack gateway keys are **not** environment variables — they are entered at runtime through
the `/payments` admin UI and sealed with `SURFGEN_ENCRYPTION_KEY`.

Cloud provider keys (`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `HEYGEN_API_KEY`, …) are left
unset; the zero-credential default renders via Piper/FFmpeg.

### 6. Application configuration

| Variable | Value | Why |
| --- | --- | --- |
| `NODE_ENV` | `production` | forces secure cookies; `JWT_SECRET` becomes mandatory |
| `NEXT_PUBLIC_API_URL` | `https://surfgen.io` | **build arg** — baked into the client bundle |
| `NEXT_PUBLIC_SITE_URL` | `https://surfgen.io` | OG `metadataBase`; otherwise resolves to localhost |
| `PUBLIC_API_URL` | `https://surfgen.io` | media link base for the `local` storage driver |
| `PUBLIC_WEB_URL` | `https://surfgen.io` | email verification link host |
| `CORS_ORIGINS` | `https://surfgen.io` | same-origin, but set explicitly |
| `COOKIE_SECURE` | unset | already forced by `NODE_ENV=production` |
| `WORKER_QUEUES` | `cpu.default,cpu.media,gpu.default,gpu.heavy,io.webhooks,io.analytics` | single worker serves all classes |

`NEXT_PUBLIC_*` values are inlined into the compiled JavaScript at build time, so changing the
domain later requires an image **rebuild**, not a restart.

### 7. Email verification

`REQUIRE_EMAIL_VERIFICATION=true`, with SMTP credentials supplied by the user at deploy time:
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.

Without SMTP, `MailerService` only logs the verification link, which would block real signups
— so these are a hard prerequisite for this configuration.

If a third-party relay (Resend, Postmark, …) is used with a `MAIL_FROM` on `surfgen.io`,
SPF/DKIM records will be needed in the Hostinger-managed zone for deliverability. Out of scope
for the deploy itself, but noted.

### 8. DNS and TLS cutover

**Ordering is a hard constraint.** `surfgen.io` currently resolves to the parking IP, so an
HTTP-01 challenge issued today would fail, and Let's Encrypt rate-limits failed validations
(5 per hostname per hour). DNS must therefore be repointed **and propagated before** the
stack is brought up.

1. Update the zone via the Hostinger DNS API: `@` A `2.57.91.91` → `76.13.44.91`.
2. `www` CNAME already targets the apex and inherits the change.
3. Confirm propagation (TTL is 50 s, so this is fast).
4. Bring the stack up; Traefik then completes HTTP-01 and issues certificates automatically.

Rollback is a single A-record revert.

### 9. Database

No `migrations/` directory exists yet, so the `migrate` service's
`prisma migrate deploy || prisma db push` falls through to `db push`, which creates the schema
including `PaymentGatewaySetting` and `Plan`. That is acceptable for the first deploy.

Follow-up: generate a baseline migration from the running container and commit it, so
subsequent deploys have real migration history.

### 10. Pre-deploy fixes

- **GitHub links 404 on the public landing page.** Five occurrences of
  `https://github.com/BBGNSURF/SurfGen` (verified 404) in
  `apps/web/components/marketing/marketing-footer.tsx` (×3),
  `pricing-section.tsx:73`, `marketing-nav.tsx:51`. The real repository is
  `https://github.com/BbgnsurfTech/SurfGen` (verified 200).
- Worker `replicas: 2` → `1`.
- Set `NEXT_PUBLIC_SITE_URL`.

## Deliverables

1. `.dockerignore` (repo root).
2. `infra/docker/docker-compose.hostinger.yml` — Traefik-labelled, no published ports, no
   MinIO, shared media volume, worker ×1.
3. Marketing GitHub-URL fix (5 occurrences).
4. DNS change to `surfgen.io`.
5. `/docker/surfgen/.env` on the VPS (secrets, not committed).
6. Deployment runbook appended to `docs/guides/deployment.md`.

The existing `docker-compose.full.yml` is left untouched: it remains the portable
local/self-host reference, while the new file is the VPS-specific overlay.

## Verification gate

1. `docker compose ps` — all services healthy; `migrate` exited 0.
2. `https://surfgen.io/healthz` and `/readyz` return 200 over valid TLS.
3. Certificate chain valid for both `surfgen.io` and `www.surfgen.io`; `www` redirects.
4. Landing page renders; pricing section loads live plans from `GET /v1/billing/plans`.
   (If server-side rendering cannot hairpin the public hostname from inside the container,
   the section's existing fallback engages — verify which path is taken.)
5. Signup → verification email received → login succeeds.
6. WebSocket `/ws` connects and streams progress.
7. **One video renders end to end and plays back in the browser** — the decisive test of the
   storage decision in §3.
8. Co-tenants unaffected: `bedrock.asointelligence.com` and `aso-website` still serve.

## Risks

| Risk | Mitigation |
| --- | --- |
| Next.js build OOMs or is slow on 2 vCPU | 6.8 GB free; build with the stack down; `.dockerignore` cuts context 1.6 GB → MB |
| LE rate limit from premature challenges | Repoint DNS **before** first `up` (§8) |
| Disk pressure (58/100 GB used) | Prune the 7 stopped co-tenant projects' images first |
| SSR cannot hairpin `surfgen.io` from inside the container | Fallback exists in pricing section; verify at gate 4 |
| Secret leakage into image layers | `.dockerignore` (§4) — required, not optional |
| Media volume not shared between api and worker | Explicit named volume in both services (§3) |

## Decisions taken

| Decision | Choice | Alternative rejected |
| --- | --- | --- |
| Build location | On the VPS from git | CI → GHCR (deferred; topology stays compatible) |
| Stack scope | Core app stack | + observability (RAM, unauthenticated surfaces); minimal (cannot render) |
| Hostname | `surfgen.io` single origin | split `api.` subdomain (adds CORS + a second cert) |
| Storage | `local` driver + shared volume | MinIO (broken presign host; needs a public hostname) |
| Database | Dedicated Postgres 16 | reuse `postgresql-u6ju` (shared lifecycle; publicly published port) |
| Email verification | ON, user-supplied SMTP | OFF; ON with links only in logs |
| Proxy network | None — labels only, per `bedrock` | shared external network (unnecessary: Traefik is host-networked) |
