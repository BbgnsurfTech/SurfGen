# SurfGen system test suites (Phase 8)

Pre-release test scaffolding that runs against a **live stack** — none of it
joins the pnpm workspace (`pnpm-workspace.yaml` globs are `apps/*`,
`apps/workers/*`, `packages/*`, `plugins/*`), none of it is part of the turbo
`test` gate, and nothing here has npm dependencies.

Start the stack first:

```bash
JWT_SECRET=$(openssl rand -hex 32) \
  docker compose -f infra/docker/docker-compose.full.yml up --build -d
curl -fsS http://localhost:4000/healthz
```

## Suites

| Suite | Tool | What it covers | Docs |
|---|---|---|---|
| [`load/`](load/README.md) | k6 (plain JS) | `smoke.js` (healthz + login + list orgs, latency/error thresholds) and `video-flow.js` (register → project → create video → generate → poll status) | k6 install, env vars, thresholds, `RATE_LIMIT_MAX` guidance |
| [`security/`](security/README.md) | OWASP ZAP + `pnpm audit` | Passive baseline scan of the API (`:4000`) and web app (`:3000`) with a justified rule config; dependency audit guidance | `zap-baseline.conf` with per-rule justifications |
| [`chaos/`](chaos/README.md) | bash + curl + jq + docker | `kill-worker.sh`: SIGKILLs the worker mid-render and proves the pipeline resumes to completion (BullMQ stalled-job recovery, `runId:stage` job dedupe, DB-persisted run state) | prerequisites, expected output, `WORKER_QUEUES` caveat |

## When to run

These are **pre-release** suites — run before cutting a release, after
significant pipeline/API changes, or when infra dependencies (BullMQ, Redis,
RabbitMQ, Postgres images) are upgraded:

1. `pnpm turbo lint typecheck test build` — the fast per-package gate (CI runs
   this on every push/PR via `.github/workflows/ci.yml`).
2. `tests/load/smoke.js` — sanity + latency baseline against the stack.
3. `tests/security/` — ZAP baseline against API and web; `pnpm audit`
   (also blocking in CI via `.github/workflows/security.yml`).
4. `tests/chaos/kill-worker.sh` — resilience proof.
5. `tests/load/video-flow.js` — sustained end-to-end load (raise
   `RATE_LIMIT_MAX` first; see `load/README.md`).

## Coverage

Unit/integration coverage is **not** measured here — it runs per package via
vitest with the v8 provider:

```bash
pnpm -r test:coverage        # every workspace package with a test:coverage script
pnpm test:coverage           # equivalent via turbo (root package.json script)
```

Thresholds are already configured in each package's `vitest.config.ts`
(verified in `packages/core` and `packages/queue`):

```ts
coverage: {
  provider: 'v8',
  include: ['src/**'],
  thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
}
```

`vitest run --coverage` fails the run when a threshold is missed, so coverage
is enforced wherever a package wires the script (e.g. `@surfgen/api` runs it
with `--passWithNoTests`).
