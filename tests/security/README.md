# Security tests

Two layers: an OWASP ZAP **baseline scan** against a live stack, and
**dependency auditing** via `pnpm audit`. Neither joins the pnpm workspace or
turbo pipeline; the audit also runs in CI via
`.github/workflows/security.yml` (the ZAP job there is `workflow_dispatch`
only because it needs a live stack).

## ZAP baseline scan

The baseline scan is passive (spider + passive rules) — safe to run against a
local stack, and it does not attack or mutate data.

### 1. Start the stack

```bash
# From the repo root: API on :4000, web on :3000
JWT_SECRET=$(openssl rand -hex 32) docker compose -f infra/docker/docker-compose.full.yml up --build -d
curl -fsS http://localhost:4000/healthz
```

(`infra/docker/docker-compose.dev.yml` is infrastructure-only — it does NOT
start the API/web containers; use it only when running the apps on the host
with `pnpm dev`.)

### 2. Scan the API

```bash
docker run --rm --network host \
  -v "$PWD/tests/security:/zap/wrk:ro" \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t http://localhost:4000 \
  -c zap-baseline.conf
```

- On macOS/Windows, `--network host` does not reach the host: replace the
  target with `-t http://host.docker.internal:4000` and drop `--network host`.
- The OpenAPI document at `http://localhost:4000/docs/openapi.json` can seed
  the spider for deeper coverage: `zap-api-scan.py -t http://localhost:4000/docs/openapi.json -f openapi -c zap-baseline.conf`.

### 3. Scan the web app

```bash
docker run --rm --network host \
  -v "$PWD/tests/security:/zap/wrk:ro" \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t http://localhost:3000 \
  -c zap-baseline.conf
```

### Rule config

`zap-baseline.conf` documents every deviation from the defaults with a
justification (tab-separated `<rule-id> <IGNORE|WARN|FAIL> <comment>`):

- **IGNORE** — expected noise on a JSON API (timestamp disclosure, minified
  bundle comments, SPA fingerprinting).
- **WARN** — environment-dependent findings (CSP on the web app, HSTS behind
  TLS-terminating ingress, permissive dev CORS) that must stay visible.
- **FAIL** — regressions that must break the scan: missing
  `X-Content-Type-Options`, error disclosure, cookies without
  HttpOnly/SameSite (the refresh cookie is httpOnly + SameSite=Strict by
  design in `apps/api/src/auth/auth.controller.ts`).

Exit code: zap-baseline exits non-zero when any FAIL-level alert fires (add
`-I` to ignore WARNs entirely; prefer keeping them visible).

## Dependency audit (`pnpm audit`)

```bash
# From the repo root — scans the whole workspace lockfile
pnpm audit --audit-level high        # fail on high/critical only
pnpm audit                           # full report, all severities
pnpm audit --json > audit.json       # machine-readable, for triage
```

Guidance:

- CI (`.github/workflows/security.yml`) runs `pnpm audit --audit-level high`
  as a **blocking** job on pushes/PRs to `main`.
- Fix by upgrading the direct dependency first (`pnpm up <pkg>`); for
  transitive-only advisories use the `pnpm.overrides` field in the root
  `package.json` to force a patched version.
- If an advisory is a true false-positive for how SurfGen uses the package,
  document the decision here (advisory ID, package, justification, revisit
  date) rather than silencing the audit globally.
