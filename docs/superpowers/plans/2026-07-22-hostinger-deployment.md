# Hostinger VPS Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the SurfGen stack in Docker on the existing Hostinger VPS, served over HTTPS at `https://surfgen.io`, with signup → login → render → playback working end to end.

**Architecture:** A VPS-specific Compose overlay (`infra/docker/docker-compose.hostinger.yml`) is deployed through the Hostinger VPS project API, which writes the compose file plus a `.env` to `/docker/surfgen/` and brings the stack up. Images build **on the VPS** directly from the public GitHub repository using a git build context — there is no SSH tooling available, so nothing is copied from the workstation. The pre-existing host-networked Traefik discovers `api` and `web` by container label and terminates TLS. Web and API share the single origin `surfgen.io`, split by path.

**Tech Stack:** Docker Compose, Traefik v3 (existing, `network_mode: host`), Postgres 16, Redis 7, RabbitMQ 3.13, NestJS/Fastify API, Next.js 15 standalone web, Node 22, pnpm 10, Prisma, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-22-hostinger-deployment-design.md`

## Global Constraints

- Target VPS: **id `1613644`**, hostname `srv1613644.hstgr.cloud`, IPv4 **`76.13.44.91`**.
- Public origin is **`https://surfgen.io`** (with `www.surfgen.io` redirecting to it). No other hostname may be claimed — `srv1613644.hstgr.cloud` is already owned by the `bedrock` project's router and claiming it again causes a router collision.
- Traefik cert resolver is named **`letsencrypt`**; entrypoints are **`web`** (:80) and **`websecure`** (:443). The HTTP→HTTPS redirect is already global — do not redeclare it.
- Traefik uses `--providers.docker.exposedbydefault=false`. Only `api` and `web` get `traefik.enable=true`.
- **No service publishes a host port.** No `ports:` key anywhere in the new compose file.
- Canonical GitHub repository is **`https://github.com/BbgnsurfTech/SurfGen`** (public). `BBGNSURF/SurfGen` is a 404 and must not appear anywhere.
- `JWT_SECRET` must be byte-identical across `api` and `worker` — the media-link HMAC is derived from it (`sha256("media:" + JWT_SECRET)`).
- Storage driver stays **`local`** (the `config/storage.yaml` default). Do **not** set any `SURFGEN_STORAGE__*` override.
- `NEXT_PUBLIC_*` values are inlined into the client bundle at **build** time. Changing them requires an image rebuild, not a restart.
- Existing `infra/docker/docker-compose.full.yml` must remain **unmodified** — it is the portable self-host reference.
- Co-tenant projects (`traefik`, `bedrock`, `aso-website`, `postgresql-u6ju`) must keep working throughout.
- Commit messages follow the repo convention: conventional-commit prefix, no attribution trailer.

## Task Order Constraint

**Task 5 (DNS) must complete before Task 6 (deploy).** `surfgen.io` currently resolves to the Hostinger parking IP `2.57.91.91`. If the stack comes up first, Traefik's HTTP-01 challenge fails against the wrong host, and Let's Encrypt rate-limits failed validations at 5 per hostname per hour — which would block issuance for an hour.

---

### Task 1: Centralize and correct the GitHub repository URLs

The marketing site hardcodes `https://github.com/BBGNSURF/SurfGen` in five places across three components. That URL **404s**; the real repository is `BbgnsurfTech/SurfGen`. Because the same literal is duplicated five times, all five broke together — so the fix is a single shared constant, not five edits.

**Files:**
- Create: `apps/web/lib/marketing/links.ts`
- Test: `apps/web/lib/marketing/links.test.ts`
- Modify: `apps/web/components/marketing/marketing-footer.tsx:17-19`
- Modify: `apps/web/components/marketing/pricing-section.tsx:73`
- Modify: `apps/web/components/marketing/marketing-nav.tsx:51`

**Interfaces:**
- Consumes: nothing.
- Produces: `GITHUB_REPO_URL: string`, `githubBlobUrl(path: string): string`, `githubReadmeAnchor(anchor: string): string` from `apps/web/lib/marketing/links.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/marketing/links.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { GITHUB_REPO_URL, githubBlobUrl, githubReadmeAnchor } from './links';

describe('GITHUB_REPO_URL', () => {
  test('points at the BbgnsurfTech organisation that actually hosts the repo', () => {
    expect(GITHUB_REPO_URL).toBe('https://github.com/BbgnsurfTech/SurfGen');
  });

  test('has no trailing slash, so callers can append path segments safely', () => {
    expect(GITHUB_REPO_URL.endsWith('/')).toBe(false);
  });
});

describe('githubBlobUrl', () => {
  test('builds a default-branch blob link for a repo-relative path', () => {
    // Arrange
    const path = 'docs/roadmap.md';
    // Act
    const url = githubBlobUrl(path);
    // Assert
    expect(url).toBe('https://github.com/BbgnsurfTech/SurfGen/blob/main/docs/roadmap.md');
  });
});

describe('githubReadmeAnchor', () => {
  test('builds a README anchor link', () => {
    expect(githubReadmeAnchor('quick-start')).toBe(
      'https://github.com/BbgnsurfTech/SurfGen#quick-start',
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm -C apps/web exec vitest run lib/marketing/links.test.ts
```

Expected: FAIL — `Failed to resolve import "./links"`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/lib/marketing/links.ts`:

```ts
/**
 * Canonical GitHub repository for the open-source project.
 *
 * Kept in one place because the marketing surface links to it from the nav,
 * the pricing CTA and three footer entries — when it was duplicated inline,
 * every copy carried the same wrong org and all five links 404'd together.
 */
export const GITHUB_REPO_URL = 'https://github.com/BbgnsurfTech/SurfGen';

/** Deep link to a file on the repository's default branch. */
export function githubBlobUrl(path: string): string {
  return `${GITHUB_REPO_URL}/blob/main/${path}`;
}

/** Anchor link into the repository README. */
export function githubReadmeAnchor(anchor: string): string {
  return `${GITHUB_REPO_URL}#${anchor}`;
}
```

- [ ] **Step 4: Run the test and verify it passes**

```bash
pnpm -C apps/web exec vitest run lib/marketing/links.test.ts
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Replace the footer's three hardcoded links**

In `apps/web/components/marketing/marketing-footer.tsx`, add the import directly below the existing `next/link` import:

```tsx
import Image from 'next/image';
import Link from 'next/link';
import { GITHUB_REPO_URL, githubBlobUrl, githubReadmeAnchor } from '@/lib/marketing/links';
```

Then replace the three entries in the `Open source` column (currently lines 17-19):

```tsx
  {
    title: 'Open source',
    links: [
      { href: GITHUB_REPO_URL, label: 'GitHub' },
      { href: githubReadmeAnchor('quick-start'), label: 'Self-host guide' },
      { href: githubBlobUrl('docs/roadmap.md'), label: 'Roadmap' },
    ],
  },
```

- [ ] **Step 6: Replace the pricing CTA link**

In `apps/web/components/marketing/pricing-section.tsx`, add to the imports at the top of the file:

```tsx
import { GITHUB_REPO_URL } from '@/lib/marketing/links';
```

Then change line 73 from `href="https://github.com/BBGNSURF/SurfGen"` to:

```tsx
          href={GITHUB_REPO_URL}
```

- [ ] **Step 7: Replace the nav link**

In `apps/web/components/marketing/marketing-nav.tsx`, add to the imports at the top of the file:

```tsx
import { GITHUB_REPO_URL } from '@/lib/marketing/links';
```

Then change line 51 from `href="https://github.com/BBGNSURF/SurfGen"` to:

```tsx
            href={GITHUB_REPO_URL}
```

- [ ] **Step 8: Verify no stale occurrence remains anywhere**

```bash
grep -rn "github.com/BBGNSURF" apps packages plugins 2>/dev/null | grep -v node_modules || echo "clean: no stale org references"
```

Expected: `clean: no stale org references`.

Match the **URL literal**, not the bare token. `BBGNSURF` on its own is legitimate brand
copy — `BBGNSURF · AI VIDEO` in `login`, `signup`, `verify-email` and `sidebar`, plus a
`BBGNSURF Core` placeholder in `brand-form` — so a grep for the bare token can never print
`clean` and would wrongly read as a failure.

- [ ] **Step 9: Verify the import alias resolves and types check**

```bash
pnpm -C apps/web typecheck && pnpm -C apps/web exec vitest run
```

Expected: both PASS. (If `@/lib/...` does not resolve, check the `paths` mapping in `apps/web/tsconfig.json` and use a relative import instead.)

- [ ] **Step 10: Commit**

```bash
git add apps/web/lib/marketing/links.ts apps/web/lib/marketing/links.test.ts \
        apps/web/components/marketing/marketing-footer.tsx \
        apps/web/components/marketing/pricing-section.tsx \
        apps/web/components/marketing/marketing-nav.tsx
git commit -m "fix(web): point marketing GitHub links at the repo that exists

All five links pointed at github.com/BBGNSURF/SurfGen, which 404s — the
repository is BbgnsurfTech/SurfGen. The literal was duplicated across the nav,
the pricing CTA and three footer entries, so every copy carried the same typo.
Extracts GITHUB_REPO_URL plus blob/anchor helpers so there is one place to be
wrong next time."
```

---

### Task 2: Add `.dockerignore`

Both Dockerfiles use `COPY . .` and no `.dockerignore` exists. The build context is **1.6 GB** (1.1 GB `node_modules`, 215 MB `.turbo`, a 732 KB archive), all of which is tarred and shipped to the daemon before the first build step runs.

The security half matters more: Docker honours `.dockerignore` only — **not** `.gitignore`. Compose reads `.env` from its project directory, so a populated `.env` next to a compose file would be baked into an image layer by `COPY . .`, embedding `JWT_SECRET`, `POSTGRES_PASSWORD` and `SURFGEN_ENCRYPTION_KEY` where they survive later deletion.

**Files:**
- Create: `.dockerignore`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable; affects every `docker build` in the repo.

- [ ] **Step 1: Measure the current build context**

```bash
time docker build -q -f infra/docker/Dockerfile.web --target base -t surfgen-ctx-probe . && echo "--- context probe built ---"
```

`--target base` stops at the trivial first stage, so essentially all elapsed time is context transfer. Note the elapsed time — expect tens of seconds.

- [ ] **Step 2: Create `.dockerignore`**

```
# Build context hygiene. Docker does NOT read .gitignore — anything omitted
# here is shipped to the daemon and can be captured by `COPY . .`.

# Secrets — must never enter an image layer.
.env
.env.*
!.env.example

# Dependencies and build caches — reinstalled inside the image.
node_modules
**/node_modules
.turbo
**/.turbo
**/dist
**/.next
**/build
**/.venv
__pycache__

# VCS and local tooling.
.git
.github
.claude
.superpowers
.DS_Store

# Test and coverage artifacts.
coverage
**/coverage
**/test-results
**/playwright-report
apps/web/e2e/__screenshots__

# Local storage and archives.
storage
*.zip

# Infra that no image build needs.
infra/k8s
infra/terraform
infra/monitoring
docs
tests
```

- [ ] **Step 3: Verify the context shrank**

```bash
docker builder prune -f >/dev/null 2>&1
time docker build -q -f infra/docker/Dockerfile.web --target base -t surfgen-ctx-probe . && echo "--- context probe rebuilt ---"
```

Expected: markedly faster than Step 1 (seconds, not tens of seconds).

- [ ] **Step 4: Verify `.env` can no longer be captured**

```bash
docker build -q -f infra/docker/Dockerfile.api --target build -t surfgen-env-probe . >/dev/null && \
docker run --rm surfgen-env-probe sh -c 'ls -la /app/.env 2>&1 || echo "GOOD: no .env in image"'
```

Expected: `GOOD: no .env in image`.

> If this build is slow, that is expected — it runs a full `pnpm install`. It is worth doing once here because it proves the security property the whole task exists for.

- [ ] **Step 5: Confirm `docs/` exclusion did not break a build**

`docs` is excluded from the context but no Dockerfile reads it — Step 4 building successfully is the proof. If a future build needs it, remove that line.

- [ ] **Step 6: Clean up probe images**

```bash
docker rmi -f surfgen-ctx-probe surfgen-env-probe 2>/dev/null; echo done
```

- [ ] **Step 7: Commit**

```bash
git add .dockerignore
git commit -m "build: add .dockerignore to shrink context and keep .env out of images

Both Dockerfiles do COPY . . against a 1.6 GB context (1.1 GB node_modules,
215 MB .turbo), all of which is tarred to the daemon before the first build
step. Docker honours .dockerignore and not .gitignore, so a compose-adjacent
.env would otherwise be baked into an image layer and survive deletion in a
later one."
```

---

### Task 3: Make the Dockerfiles deployment-ready

Two blocking defects for this deployment, both invisible until runtime:

1. **Volume ownership.** `api` and `worker` both run as the non-root `surfgen` user, and both will mount the shared `media` volume at `/app/storage/local`. Docker initialises a fresh named volume from the image's content at that path — including ownership. That directory does **not** exist in either image, so Docker creates it `root:root` and the non-root process cannot write. Renders would fail with `EACCES`. Pre-creating it with the right owner makes Docker propagate that ownership to the volume.

2. **Missing build arg.** `apps/web` reads `NEXT_PUBLIC_SITE_URL` for the root layout's `metadataBase`, but `Dockerfile.web` only declares `ARG NEXT_PUBLIC_API_URL`. An undeclared build arg is silently ignored, so OG URLs would resolve to localhost.

**Files:**
- Modify: `infra/docker/Dockerfile.api` (runtime stage, after the `adduser` line)
- Modify: `infra/docker/Dockerfile.worker` (runtime stage, after the `adduser` line)
- Modify: `infra/docker/Dockerfile.web` (build stage, alongside the existing `ARG`)

**Interfaces:**
- Consumes: nothing.
- Produces: images with a writable `/app/storage/local` owned by `surfgen`, and a web image honouring `NEXT_PUBLIC_SITE_URL`.

- [ ] **Step 1: Give `Dockerfile.api` a writable media directory**

In `infra/docker/Dockerfile.api`, immediately after the line `RUN addgroup -S surfgen && adduser -S surfgen -G surfgen` in the **runtime** stage, add:

```dockerfile
# Pre-create the local-storage root so a fresh named volume inherits surfgen
# ownership. Docker seeds an empty volume from the image path, including its
# owner; without this the volume lands root-owned and the non-root process
# cannot write rendered media into it.
RUN mkdir -p /app/storage/local && chown -R surfgen:surfgen /app/storage
```

- [ ] **Step 2: Give `Dockerfile.worker` the same directory**

In `infra/docker/Dockerfile.worker`, immediately after `RUN apk add --no-cache ffmpeg && addgroup -S surfgen && adduser -S surfgen -G surfgen`, add:

```dockerfile
# Same rationale as Dockerfile.api — the worker writes rendered output here and
# the API serves it from the same volume.
RUN mkdir -p /app/storage/local && chown -R surfgen:surfgen /app/storage
```

- [ ] **Step 3: Declare `NEXT_PUBLIC_SITE_URL` in `Dockerfile.web`**

In `infra/docker/Dockerfile.web`, in the `build` stage, directly below the existing `ARG NEXT_PUBLIC_API_URL` / `ENV NEXT_PUBLIC_API_URL` pair, add:

```dockerfile
# Root layout metadataBase. Also NEXT_PUBLIC_*, so it is inlined at build time —
# left unset, Open Graph URLs resolve against localhost.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
```

- [ ] **Step 4: Verify the media directory is writable by the runtime user**

```bash
docker build -q -f infra/docker/Dockerfile.api -t surfgen-perm-probe . >/dev/null && \
docker run --rm -v surfgen_perm_test:/app/storage/local surfgen-perm-probe \
  sh -c 'touch /app/storage/local/probe && echo "GOOD: writable as $(id -un)"'
```

Expected: `GOOD: writable as surfgen`.

This mounts a genuinely fresh named volume, which is exactly the failure condition being guarded against.

- [ ] **Step 5: Clean up the probe volume and image**

```bash
docker volume rm surfgen_perm_test >/dev/null 2>&1; docker rmi -f surfgen-perm-probe >/dev/null 2>&1; echo done
```

- [ ] **Step 6: Commit**

```bash
git add infra/docker/Dockerfile.api infra/docker/Dockerfile.worker infra/docker/Dockerfile.web
git commit -m "fix(docker): pre-create the media dir and declare the site-url build arg

api and worker both run as non-root and will share a named volume at
/app/storage/local. Docker seeds a fresh volume from the image's content at
that path including ownership, and neither image had the directory — so the
volume came up root-owned and renders would fail with EACCES.

Dockerfile.web also only declared ARG NEXT_PUBLIC_API_URL; an undeclared build
arg is ignored silently, so NEXT_PUBLIC_SITE_URL never reached the bundle and
Open Graph URLs resolved to localhost."
```

---

### Task 4: Author the Hostinger Compose overlay

A VPS-specific overlay, kept separate so `docker-compose.full.yml` stays portable.

Three things distinguish it from the full stack. It uses a **git build context**, because the Hostinger project API accepts only compose YAML plus env — nothing is copied from the workstation and there is no clone step, so Docker fetches the public repo itself and builds on the VPS. It publishes **no host ports**, relying on host-networked Traefik reaching containers at their bridge IPs. And it **drops MinIO** in favour of the `local` storage driver (see spec §3 — presigned MinIO URLs would embed the unreachable internal host `http://minio:9000`).

**Files:**
- Create: `infra/docker/docker-compose.hostinger.yml`
- Create: `infra/docker/.env.hostinger.example`

**Interfaces:**
- Consumes: `.dockerignore` (Task 2) and the Dockerfile fixes (Task 3), both of which must be **pushed to `main`** before the git context can pick them up.
- Produces: compose project named `surfgen` with services `postgres`, `redis`, `rabbitmq`, `migrate`, `api`, `worker`, `web` and volumes `pgdata`, `redisdata`, `rabbitdata`, `media`.

- [ ] **Step 1: Create `infra/docker/.env.hostinger.example`**

```bash
# Template for /docker/surfgen/.env on the Hostinger VPS.
# Real values are generated at deploy time and never committed.

# --- generated secrets -------------------------------------------------------
POSTGRES_PASSWORD=replace-me
RABBITMQ_PASSWORD=replace-me
# Must be byte-identical for api and worker: the media-link HMAC is
# sha256("media:" + JWT_SECRET), so a mismatch breaks playback URLs.
JWT_SECRET=replace-me
# 32 bytes, AES-256-GCM key sealing the Paystack secret key at rest.
SURFGEN_ENCRYPTION_KEY=replace-me
SEED_ADMIN_PASSWORD=replace-me

# --- SMTP (required: REQUIRE_EMAIL_VERIFICATION is on) -----------------------
SMTP_HOST=replace-me
SMTP_PORT=587
SMTP_USER=replace-me
SMTP_PASS=replace-me
MAIL_FROM=noreply@surfgen.io
```

- [ ] **Step 2: Create `infra/docker/docker-compose.hostinger.yml`**

```yaml
# SurfGen on the Hostinger VPS (srv1613644 / 76.13.44.91), served at
# https://surfgen.io.
#
# Deployed through the Hostinger VPS project API, which writes this file plus a
# .env to /docker/surfgen/ and brings the stack up. There is no SSH step and
# nothing is copied from a workstation, so images build on the VPS straight from
# the public repository via a git build context.
#
# Differences from docker-compose.full.yml, which stays the portable reference:
#   * git build context instead of a local path
#   * no published host ports — host-networked Traefik reaches bridge IPs, and
#     publishing would expose Postgres/RabbitMQ and collide with bedrock on 3000
#   * no MinIO — the s3 driver presigns against SURFGEN_STORAGE__ENDPOINT, so
#     browsers would receive unreachable http://minio:9000/... URLs. The local
#     driver signs links to the API's own /v1/media instead.
name: surfgen

x-git-context: &git-context https://github.com/BbgnsurfTech/SurfGen.git#main

x-app-env: &app-env
  NODE_ENV: production
  DATABASE_URL: postgresql://surfgen:${POSTGRES_PASSWORD}@postgres:5432/surfgen
  REDIS_HOST: redis
  REDIS_PORT: "6379"
  AMQP_URL: amqp://surfgen:${RABBITMQ_PASSWORD}@rabbitmq:5672
  JWT_SECRET: ${JWT_SECRET}
  SURFGEN_ENCRYPTION_KEY: ${SURFGEN_ENCRYPTION_KEY}
  # Base for HMAC-signed /v1/media playback links (local storage driver).
  PUBLIC_API_URL: https://surfgen.io
  # Host used in signup verification emails.
  PUBLIC_WEB_URL: https://surfgen.io
  CORS_ORIGINS: https://surfgen.io
  # COOKIE_SECURE is intentionally unset: NODE_ENV=production already forces it.
  REQUIRE_EMAIL_VERIFICATION: "true"
  SMTP_HOST: ${SMTP_HOST}
  SMTP_PORT: ${SMTP_PORT:-587}
  SMTP_USER: ${SMTP_USER}
  SMTP_PASS: ${SMTP_PASS}
  MAIL_FROM: ${MAIL_FROM}

services:
  # ------------------------------------------------------------ infrastructure
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: surfgen
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: surfgen
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U surfgen"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: surfgen
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD}
    volumes:
      - rabbitdata:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  # ------------------------------------------------------ migration + seeding
  migrate:
    build:
      context: *git-context
      dockerfile: infra/docker/Dockerfile.api
      target: build
    # No migrations directory exists yet, so migrate deploy falls through to
    # db push. The seed is idempotent (upsert / findFirst-guarded create), so
    # it is safe on every deploy.
    command: >
      /bin/sh -c "(pnpm --filter @surfgen/db exec prisma migrate deploy ||
                   pnpm --filter @surfgen/db exec prisma db push) &&
                  pnpm --filter @surfgen/db seed"
    environment:
      DATABASE_URL: postgresql://surfgen:${POSTGRES_PASSWORD}@postgres:5432/surfgen
      SEED_ADMIN_PASSWORD: ${SEED_ADMIN_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"

  # -------------------------------------------------------------- applications
  api:
    build:
      context: *git-context
      dockerfile: infra/docker/Dockerfile.api
    environment:
      <<: *app-env
      PORT: "4000"
    volumes:
      - media:/app/storage/local
    depends_on:
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
    restart: unless-stopped
    labels:
      - traefik.enable=true
      # Priority 100 so the API's paths win over the web catch-all below,
      # rather than relying on Traefik's rule-length heuristic.
      - "traefik.http.routers.surfgen-api.rule=Host(`surfgen.io`) && (PathPrefix(`/v1`) || PathPrefix(`/ws`) || PathPrefix(`/docs`) || Path(`/healthz`) || Path(`/readyz`))"
      - traefik.http.routers.surfgen-api.entrypoints=websecure
      - traefik.http.routers.surfgen-api.tls.certresolver=letsencrypt
      - traefik.http.routers.surfgen-api.priority=100
      - traefik.http.routers.surfgen-api.service=surfgen-api
      - traefik.http.services.surfgen-api.loadbalancer.server.port=4000

  worker:
    build:
      context: *git-context
      dockerfile: infra/docker/Dockerfile.worker
    environment:
      <<: *app-env
      # One worker serves every queue class; "gpu" names are scheduling labels
      # and the reference providers (piper/ffmpeg) run on CPU.
      WORKER_QUEUES: cpu.default,cpu.media,gpu.default,gpu.heavy,io.webhooks,io.analytics
    volumes:
      - media:/app/storage/local
    depends_on:
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy
    restart: unless-stopped

  web:
    build:
      context: *git-context
      dockerfile: infra/docker/Dockerfile.web
      args:
        # Inlined into the client bundle — changing these needs a rebuild.
        NEXT_PUBLIC_API_URL: https://surfgen.io
        NEXT_PUBLIC_SITE_URL: https://surfgen.io
    environment:
      NEXT_PUBLIC_API_URL: https://surfgen.io
      NEXT_PUBLIC_SITE_URL: https://surfgen.io
    depends_on:
      - api
    restart: unless-stopped
    labels:
      - traefik.enable=true
      # One router per hostname rather than a single two-host rule, so a
      # pending DNS record for one cannot block the other's cert issuance.
      - "traefik.http.routers.surfgen-web.rule=Host(`surfgen.io`)"
      - traefik.http.routers.surfgen-web.entrypoints=websecure
      - traefik.http.routers.surfgen-web.tls.certresolver=letsencrypt
      - traefik.http.routers.surfgen-web.priority=1
      - traefik.http.routers.surfgen-web.service=surfgen-web
      - "traefik.http.routers.surfgen-www.rule=Host(`www.surfgen.io`)"
      - traefik.http.routers.surfgen-www.entrypoints=websecure
      - traefik.http.routers.surfgen-www.tls.certresolver=letsencrypt
      - traefik.http.routers.surfgen-www.priority=1
      - traefik.http.routers.surfgen-www.service=surfgen-web
      - traefik.http.routers.surfgen-www.middlewares=surfgen-www-redirect
      # $$ escapes compose interpolation so Traefik receives ${1}.
      - "traefik.http.middlewares.surfgen-www-redirect.redirectregex.regex=^https://www\\.surfgen\\.io/(.*)"
      - traefik.http.middlewares.surfgen-www-redirect.redirectregex.replacement=https://surfgen.io/$${1}
      - traefik.http.middlewares.surfgen-www-redirect.redirectregex.permanent=true
      - traefik.http.services.surfgen-web.loadbalancer.server.port=3000

volumes:
  pgdata:
  redisdata:
  rabbitdata:
  media:
```

- [ ] **Step 3: Validate the compose file parses and interpolates**

```bash
cd infra/docker && \
POSTGRES_PASSWORD=x RABBITMQ_PASSWORD=x JWT_SECRET=x SURFGEN_ENCRYPTION_KEY=x \
SEED_ADMIN_PASSWORD=x SMTP_HOST=smtp.example.com SMTP_USER=u SMTP_PASS=p \
MAIL_FROM=noreply@surfgen.io \
docker compose -f docker-compose.hostinger.yml config >/tmp/surfgen-rendered.yml && \
echo "VALID" && cd -
```

Expected: `VALID`, no warnings about undefined variables.

- [ ] **Step 4: Verify no host ports are published**

```bash
grep -nE "^\s+ports:|^\s+- \"[0-9]+:" /tmp/surfgen-rendered.yml && echo "FAIL: a port is published" || echo "GOOD: no published ports"
```

Expected: `GOOD: no published ports`.

- [ ] **Step 5: Verify the `www` redirect escaped correctly**

```bash
grep -n "redirectregex.replacement" /tmp/surfgen-rendered.yml
```

Expected: the value is `https://surfgen.io/$${1}` — a **double** `$`, same as the source file.

`docker compose config` re-escapes `$` as `$$` so its output can be fed back in without a
second round of interpolation. A double `$` here therefore means the escaping is *correct*;
seeing a single `$` would mean compose had already consumed it. This step cannot distinguish
a genuine bug — verify the effective value on a running container instead:

```bash
docker inspect surfgen-web-1 \
  --format '{{ index .Config.Labels "traefik.http.middlewares.surfgen-www-redirect.redirectregex.replacement" }}'
```

Expected there: `https://surfgen.io/${1}` — a single `$`, since compose has interpolated once
on the way in. Task 7 Step 4 is the real end-to-end proof.

- [ ] **Step 6: Verify both apps share one JWT secret and the storage override is absent**

```bash
grep -c "JWT_SECRET: x" /tmp/surfgen-rendered.yml   # expect 3 (x-app-env anchor, api, worker)
grep -n "SURFGEN_STORAGE__" /tmp/surfgen-rendered.yml && echo "FAIL: storage override present" || echo "GOOD: local driver default retained"
```

Expected: `3`, then `GOOD: local driver default retained`.

The count is `3`, not `2`: `docker compose config` preserves the `x-app-env` extension block,
so the anchor's own `JWT_SECRET` is emitted alongside the two services that merge it. What
matters is that all three render the *same* value — a mismatch there breaks media playback.

- [ ] **Step 7: Verify the media volume is mounted in both api and worker**

```bash
grep -c "media:/app/storage/local\|source: media" /tmp/surfgen-rendered.yml
```

Expected: `2` or more. If it is `1`, playback will fail because the API cannot see what the worker rendered.

- [ ] **Step 8: Confirm the full compose file is untouched**

```bash
git diff --quiet infra/docker/docker-compose.full.yml && echo "GOOD: full compose untouched" || echo "FAIL: full compose modified"
```

Expected: `GOOD: full compose untouched`.

- [ ] **Step 9: Commit and push**

The git build context reads `main`, so Tasks 1-4 must be on the remote before deploying.

```bash
git add infra/docker/docker-compose.hostinger.yml infra/docker/.env.hostinger.example
git commit -m "feat(infra): add Hostinger VPS compose overlay for surfgen.io

Deployed through the Hostinger project API, which takes compose YAML plus env
and has no clone step — so images build on the VPS from a git context rather
than a local path.

Publishes no host ports: Traefik there runs network_mode: host and reaches
containers at their bridge IPs, so publishing would only expose Postgres and
RabbitMQ and collide with bedrock on 3000. Web and API share one origin split
by path, which removes CORS entirely.

Drops MinIO for the local storage driver — S3Storage presigns against the
configured endpoint, so browsers would get unreachable http://minio:9000 URLs,
and the cdn.baseUrl key that would rewrite the host is declared in schemas.ts
but never read."
git push origin main
```

- [ ] **Step 10: Verify the remote has the changes**

```bash
git fetch origin && git status -sb | head -1
```

Expected: `## main...origin/main` with no `ahead` marker.

---

### Task 5: Repoint DNS to the VPS

**This must complete before Task 6.** `surfgen.io` resolves to the Hostinger parking IP `2.57.91.91`. Bringing the stack up first makes Traefik attempt HTTP-01 against the wrong host; Let's Encrypt rate-limits failed validations at 5 per hostname per hour.

The zone is registered at Namecheap but delegated to Hostinger nameservers (`solar`/`lunar.dns-parking.com`), so the Hostinger DNS API can manage it.

**Files:** none — this is an API operation against live infrastructure.

**Interfaces:**
- Consumes: nothing.
- Produces: `surfgen.io` and `www.surfgen.io` resolving to `76.13.44.91`.

- [ ] **Step 1: Record the current zone for rollback**

Call `mcp__hostinger-dns__DNS_getDNSRecordsV1` with `domain: "surfgen.io"` and save the output.

Expected (current state):

```
A     @     2.57.91.91     ttl 50
CNAME www   surfgen.io.    ttl 300
```

- [ ] **Step 2: Point the apex at the VPS**

Call `mcp__hostinger-dns__DNS_updateDNSRecordsV1` with `domain: "surfgen.io"`, setting the `@` A record to `76.13.44.91`. Leave the `www` CNAME alone — it targets the apex and inherits the change.

- [ ] **Step 3: Verify the zone now reads back correctly**

Call `mcp__hostinger-dns__DNS_getDNSRecordsV1` for `surfgen.io`.

Expected: `@` A is `76.13.44.91`; the `www` CNAME is unchanged.

- [ ] **Step 4: Verify public resolution**

```bash
dig +short surfgen.io A; echo "--- www ---"; dig +short www.surfgen.io A
```

Expected: both print `76.13.44.91`. TTL was 50 s, so this should be near-immediate. If the old IP persists, wait 60 s and retry — do **not** proceed to Task 6 until this is correct, or Let's Encrypt will rate-limit.

- [ ] **Step 5: Confirm the VPS answers on :80 for the ACME challenge path**

```bash
curl -sS -o /dev/null -w "%{http_code} %{redirect_url}\n" http://surfgen.io/
```

Expected: a `3xx` redirecting to `https://surfgen.io/` (Traefik's global HTTP→HTTPS redirect). A 404 from Traefik is also acceptable at this stage — the stack is not up yet. A connection timeout means DNS has not propagated to your resolver.

> **Rollback:** set the `@` A record back to `2.57.91.91`.

---

### Task 6: Deploy the stack

Creates the `surfgen` compose project on the VPS. The Hostinger API writes the compose file and `.env` to `/docker/surfgen/` and brings it up; Docker clones the repo and builds three images on the VPS.

**Blocking input:** SMTP credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`). `REQUIRE_EMAIL_VERIFICATION=true` means signups cannot complete without a working relay.

**Files:** none in the repo — this creates `/docker/surfgen/{docker-compose.yml,.env}` on the VPS.

**Interfaces:**
- Consumes: the pushed compose file and Dockerfiles from Tasks 1-4; DNS from Task 5.
- Produces: running project `surfgen` with 7 services.

- [ ] **Step 1: Reclaim disk before building**

The VPS is at 58 / 100 GB and three image builds are about to land. Seven co-tenant projects are stopped and their images are reclaimable.

Call `mcp__hostinger-vps__VPS_getProjectListV1` for VM `1613644` and confirm which projects are `exited` (expected: `excalidraw-jdqy`, `hermes-agent-ym0w`, `mariadb-1z7b`, `ollama-95sj`, `open-webui-zzrk`, `paperclip-0nnx`, `phpmyadmin-n8r1`).

Do **not** delete them — only note the headroom. If a build later fails on disk space, removing the `ollama` and `open-webui` images (the two largest) is the first remedy.

- [ ] **Step 2: Generate the secrets**

```bash
printf 'POSTGRES_PASSWORD=%s\nRABBITMQ_PASSWORD=%s\nJWT_SECRET=%s\nSURFGEN_ENCRYPTION_KEY=%s\nSEED_ADMIN_PASSWORD=%s\n' \
  "$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 24)" \
  "$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 24)" \
  "$(openssl rand -base64 48 | tr -d '\n/+=' | head -c 48)" \
  "$(openssl rand -hex 32)" \
  "$(openssl rand -base64 18 | tr -d '\n/+=' | head -c 18)"
```

Alphanumerics only: these values are interpolated into a `DATABASE_URL` and an `AMQP_URL`, where `/`, `+` and `=` would need percent-encoding. `SURFGEN_ENCRYPTION_KEY` is 32 hex-encoded bytes for AES-256-GCM.

> These values pass through the tool call that creates the project and therefore appear in the session transcript. They are also written to `/docker/surfgen/.env` on the VPS. Rotate them if the transcript is shared.

- [ ] **Step 3: Assemble the environment block**

Combine Step 2's output with the user-supplied SMTP values:

```
POSTGRES_PASSWORD=<generated>
RABBITMQ_PASSWORD=<generated>
JWT_SECRET=<generated>
SURFGEN_ENCRYPTION_KEY=<generated>
SEED_ADMIN_PASSWORD=<generated>
SMTP_HOST=<user-supplied>
SMTP_PORT=<user-supplied, default 587>
SMTP_USER=<user-supplied>
SMTP_PASS=<user-supplied>
MAIL_FROM=<user-supplied>
```

- [ ] **Step 4: Create the project**

Call `mcp__hostinger-vps__VPS_createNewProjectV1` with:
- `virtualMachineId`: `1613644`
- `project_name`: `surfgen`
- `content`: the full verbatim contents of `infra/docker/docker-compose.hostinger.yml`
- `environment`: the block from Step 3

- [ ] **Step 5: Poll until the builds finish**

Three images build from source on 2 vCPUs (each runs a full `pnpm install` plus a Turbo build). Expect **20-40 minutes**. The API call returns before the build completes.

Call `mcp__hostinger-vps__VPS_getProjectContainersV1` for project `surfgen`, repeating every few minutes.

Expected end state: `postgres`, `redis`, `rabbitmq`, `api`, `worker`, `web` all `running`; `migrate` `exited (0)`.

- [ ] **Step 6: Confirm the migration and seed succeeded**

Call `mcp__hostinger-vps__VPS_getProjectLogsV1` for project `surfgen` and read the `migrate` service output.

Expected: schema creation (via `db push`, since no migrations directory exists yet) followed by seed output. If `migrate` exited non-zero, `api` and `worker` will not have started — fix before continuing.

- [ ] **Step 7: Confirm co-tenants are unaffected**

Call `mcp__hostinger-vps__VPS_getProjectListV1` for VM `1613644`.

Expected: `traefik`, `bedrock`, `aso-website`, `postgresql-u6ju` all still `running`.

```bash
curl -sS -o /dev/null -w "bedrock: %{http_code}\n" https://bedrock.asointelligence.com/
```

Expected: a 2xx/3xx — the co-tenant still serves.

---

### Task 7: Verification gate

The stack running is not the same as the stack working. Gate 6 is the decisive one — it is the only step that proves the storage decision in spec §3.

**Files:** none.

**Interfaces:**
- Consumes: the deployment from Task 6.
- Produces: a pass/fail judgement on the deployment.

- [ ] **Step 1: Health endpoints over TLS**

```bash
curl -sS -o /dev/null -w "healthz: %{http_code}\n" https://surfgen.io/healthz
curl -sS -o /dev/null -w "readyz:  %{http_code}\n" https://surfgen.io/readyz
```

Expected: `200` for both. A 404 means the API router's path rule or priority is wrong; a 502 means the container is not up.

- [ ] **Step 2: Certificate is valid for both hostnames**

```bash
echo | openssl s_client -servername surfgen.io -connect surfgen.io:443 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

Expected: issuer is Let's Encrypt, and the dates are current. If this fails, check Traefik's logs for ACME errors — the usual cause is DNS not having propagated before Task 6.

- [ ] **Step 3: Routing split is correct**

```bash
curl -sS -o /dev/null -w "web root:   %{http_code}\n" https://surfgen.io/
curl -sS -o /dev/null -w "api plans:  %{http_code}\n" https://surfgen.io/v1/billing/plans
curl -sS -o /dev/null -w "metrics:    %{http_code}\n" https://surfgen.io/metrics
```

Expected: `200`, `200`, and **not 200** for `/metrics` — it is deliberately unrouted, so Traefik should serve the web catch-all or a 404 rather than exposing worker metrics publicly.

- [ ] **Step 4: `www` redirects and preserves the path**

```bash
curl -sS -o /dev/null -w "%{http_code} -> %{redirect_url}\n" https://www.surfgen.io/signup
```

Expected: `301 -> https://surfgen.io/signup`. If the path is dropped (`-> https://surfgen.io/`), the `$${1}` escaping in the compose labels is wrong.

- [ ] **Step 5: Landing page renders with live plan data**

Open `https://surfgen.io/` in a browser. Confirm the hero renders, and check whether the pricing section shows live plans from `GET /v1/billing/plans` or its static fallback.

If it shows the fallback, server-side rendering inside the container cannot hairpin the public hostname. This is non-fatal — note it, and if it needs fixing, give the `web` service an `extra_hosts` entry mapping `surfgen.io` to the api container, or introduce a separate internal API URL for SSR.

- [ ] **Step 6: Signup → verification email → login**

Sign up at `https://surfgen.io/signup` with a real address. Confirm the verification email arrives, the link completes verification, and login succeeds.

If no email arrives, read the `api` logs via `mcp__hostinger-vps__VPS_getProjectLogsV1` — `MailerService` logs the link when SMTP is unset or failing, which distinguishes a bad relay from a bad flag.

- [ ] **Step 7: Render a video end to end and play it back**

From the studio, create a project and render one video. Watch progress stream over the `/ws` WebSocket, then play the finished video in the browser.

This is the decisive test. A completed render that will not play means the media URL is wrong; a render that fails to write means the volume ownership fix from Task 3 did not apply. Check `worker` logs for `EACCES` first.

- [ ] **Step 8: Record the outcome**

Note which gates passed. Any failure gets diagnosed before the deployment is called done.

---

### Task 8: Document the runbook

**Files:**
- Modify: `docs/guides/deployment.md` (append a new section)

**Interfaces:**
- Consumes: the verified deployment.
- Produces: documentation.

- [ ] **Step 1: Append the Hostinger section to `docs/guides/deployment.md`**

Add at the end of the file:

````markdown
## Hostinger VPS (production — surfgen.io)

The live deployment runs on Hostinger VPS `1613644` (`srv1613644.hstgr.cloud`, `76.13.44.91`)
from `infra/docker/docker-compose.hostinger.yml`, served at `https://surfgen.io`.

Design rationale: `docs/superpowers/specs/2026-07-22-hostinger-deployment-design.md`.

### How it differs from `docker-compose.full.yml`

| | full | hostinger |
| --- | --- | --- |
| Build context | local path | git URL, built on the VPS |
| Host ports | published | none — Traefik reaches bridge IPs |
| Storage | MinIO (s3 driver) | `local` driver + shared `media` volume |
| TLS | none | Traefik + Let's Encrypt |
| Worker replicas | 2 | 1 |

The VPS's Traefik runs `network_mode: host` with `exposedbydefault=false`, so services opt in
by label and no shared proxy network is needed. Only `api` and `web` are labelled.

### Routing

One origin, split by path. Priority 100 sends `/v1`, `/ws`, `/docs`, `/healthz` and `/readyz`
to `api:4000`; priority 1 sends everything else to `web:3000`. `/metrics` is deliberately
unrouted. `www.surfgen.io` redirects to the apex.

Do not add a router for `srv1613644.hstgr.cloud` — the `bedrock` project already claims it.

### Deploying a change

1. Merge to `main` and push. The compose file builds from `main`, so unpushed commits are invisible.
2. Re-create the project via the Hostinger API (`VPS_createNewProjectV1`, project `surfgen`),
   passing the same compose content and environment. Named volumes persist.
3. Poll `VPS_getProjectContainersV1` until `migrate` exits 0 and the rest are running.

`VPS_updateProjectV1` pulls newer images rather than rebuilding, so it will not pick up source
changes from a git context.

### Environment

Secrets live only in `/docker/surfgen/.env` on the VPS. `infra/docker/.env.hostinger.example`
documents the shape.

`JWT_SECRET` must be identical for `api` and `worker`: media playback links are signed with
`sha256("media:" + JWT_SECRET)`, so a mismatch produces links the API rejects.

`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SITE_URL` are inlined into the client bundle at build
time. Changing the domain requires a rebuild, not a restart.

### Storage

The `local` driver writes to the `media` volume, shared by `api` and `worker`, and the API
serves it from `GET /v1/media` behind HMAC-signed links.

The s3/MinIO path is deliberately not used here: `S3Storage.signedUrl()` presigns against the
configured endpoint, so an internal `http://minio:9000` endpoint produces URLs browsers cannot
resolve, and the `cdn.baseUrl` key that would rewrite the host is declared in
`packages/config/src/schemas.ts` but read nowhere. Moving to S3/R2 later means giving the
object store a real public hostname and setting the endpoint to it.

Both images pre-create `/app/storage/local` owned by `surfgen`, because Docker seeds a fresh
named volume from the image's content at that path including ownership — without it the volume
lands root-owned and the non-root runtime cannot write.

### Rollback

- Application: re-create the project from a previous commit by pinning the git context to a SHA
  (`...SurfGen.git#<sha>`) instead of `#main`.
- DNS: point the `surfgen.io` `@` A record back to `2.57.91.91`. TTL is 50 s.

### Known follow-ups

- No Prisma migrations directory exists, so `migrate deploy` falls through to `db push`.
  Generate a baseline migration from the running container and commit it.
- The co-tenant `postgresql-u6ju` publishes `0.0.0.0:32768`; unrelated to SurfGen but worth closing.
````

- [ ] **Step 2: Commit**

```bash
git add docs/guides/deployment.md
git commit -m "docs: add the Hostinger production runbook

Covers how the VPS overlay differs from the portable full compose, the
single-origin routing split, the redeploy loop (rebuild needs project
re-creation — update only pulls images), and the two non-obvious constraints:
JWT_SECRET must match across api and worker because media links are signed
from it, and NEXT_PUBLIC_* are build-time inlined."
git push origin main
```

---

## Self-Review

**Spec coverage.** §1 routing → Task 4 Step 2 labels, verified Task 7 Steps 3-4. §2 services → Task 4 Step 2, verified Steps 4 and 7. §3 storage → Task 3 (volume ownership) + Task 4 (no override), verified Task 4 Step 6 and Task 7 Step 7. §4 `.dockerignore` → Task 2. §5 secrets → Task 6 Step 2. §6 app config → Task 4 `x-app-env` + Task 3 Step 3 for the site-url arg. §7 email → Task 6 Step 3, verified Task 7 Step 6. §8 DNS/TLS ordering → Task 5, enforced by the ordering constraint. §9 database → Task 4 `migrate` command. §10 pre-deploy fixes → Task 1 (URLs), Task 3 (site URL), Task 4 (worker ×1). Deliverables 1-6 all map to tasks. Every verification gate maps to a step in Task 7.

**Gaps found and closed while writing.** Three things the spec did not anticipate: the shared volume would have come up root-owned and broken renders (Task 3); `NEXT_PUBLIC_SITE_URL` had no `ARG` so it would have been silently dropped (Task 3); and the spec never said how the admin user gets created — the seed is idempotent, so it now runs in the `migrate` service (Task 4). The spec also assumed a git clone on the VPS, which no available tooling can perform; the git build context achieves the same "build on the VPS from git" outcome.

**Placeholder scan.** No TBD/TODO. Every code step carries complete content; every command has an expected result.

**Type consistency.** `GITHUB_REPO_URL`, `githubBlobUrl`, `githubReadmeAnchor` are named identically in the test (Task 1 Step 1), the implementation (Step 3), and all three call sites (Steps 5-7). Service names (`postgres`, `redis`, `rabbitmq`, `migrate`, `api`, `worker`, `web`), volume names (`pgdata`, `redisdata`, `rabbitdata`, `media`), and router names (`surfgen-api`, `surfgen-web`, `surfgen-www`) are consistent between Task 4, Task 6 and Task 7.
