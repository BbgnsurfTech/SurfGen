# Load tests (k6)

Plain-JS [k6](https://k6.io) scripts — no npm dependencies, nothing here joins
the pnpm workspace or the turbo pipeline. They target a **running** SurfGen
stack; nothing in CI runs them automatically.

## Install k6

```bash
# macOS
brew install k6

# Debian/Ubuntu
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker (no install)
docker run --rm -i --network host grafana/k6 run - < tests/load/smoke.js
```

## Start the stack

```bash
# From the repo root — full containerized stack (API on :4000, web on :3000)
JWT_SECRET=$(openssl rand -hex 32) docker compose -f infra/docker/docker-compose.full.yml up --build -d
curl -fsS http://localhost:4000/healthz   # wait until this returns 200
```

Alternatively run infra via `infra/docker/docker-compose.dev.yml` and the apps
on the host with `pnpm dev` (the dev compose file contains **infrastructure
only** — postgres/redis/rabbitmq/minio — no API container).

## Scripts

### `smoke.js` — cheap correctness/latency baseline

Per iteration: `GET /healthz` → `POST /v1/auth/login` → `GET /v1/orgs`.
`setup()` auto-registers the smoke user, so it works against a fresh database.

```bash
k6 run tests/load/smoke.js
k6 run -e BASE_URL=http://localhost:4000 -e VUS=2 -e DURATION=30s tests/load/smoke.js
```

### `video-flow.js` — full generation flow

Per VU: register-or-login → resolve org (`GET /v1/orgs`) → find-or-create
project. Per iteration: create video → `POST …/videos/:id/generate` → poll
video status.

```bash
k6 run tests/load/video-flow.js
k6 run -e VUS=5 -e DURATION=3m -e EMAIL=me@example.com -e PASSWORD='longpassword-12' \
  tests/load/video-flow.js
```

**Important:** this script asserts **API behavior only** — 2xx statuses and
the `{ success, data, error, meta? }` envelope. On a zero-credential stack
(no AI provider keys) renders may end in `failed` or stall on unserved
queues; that is tolerated and does not fail thresholds. Proving actual
render completion/resume is `tests/chaos/`'s job.

## Environment variables

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `BASE_URL` | `http://localhost:4000` | both | API origin |
| `EMAIL` | smoke: `k6-smoke@surfgen.local`; video-flow: per-VU unique | both | video-flow registers throwaway users when unset |
| `PASSWORD` | script-specific | both | must be ≥ 12 chars (RegisterSchema) |
| `VUS` | smoke `2`, video-flow `3` | both | virtual users |
| `DURATION` | smoke `1m`, video-flow `2m` | both | test duration |
| `PROJECT_NAME` | `k6-load-project` | video-flow | reused across runs |
| `POLL_ATTEMPTS` | `15` | video-flow | status polls per iteration |
| `POLL_INTERVAL_SECONDS` | `2` | video-flow | delay between polls |

## Thresholds

| Script | `http_req_failed` | `http_req_duration` | `checks` |
|---|---|---|---|
| smoke.js | rate < 1% | p95 < 800 ms | rate > 99% |
| video-flow.js | rate < 5% | p95 < 1500 ms | rate > 95% |

k6 exits non-zero when a threshold is breached. Tune per environment — the
defaults assume a local compose stack on developer hardware.

## Rate limiting — RATE_LIMIT_MAX

The API registers `@fastify/rate-limit` with
`max: RATE_LIMIT_MAX ?? 300` per **1 minute** (see `apps/api/src/main.ts`).
The default scripts stay comfortably below that, but scaling up VUs — or
tightening `POLL_INTERVAL_SECONDS` — will start returning 429s, which count
as failed requests and wreck the `http_req_failed` threshold.

For real load runs, raise the limit on the API container:

```bash
# docker compose: add to the api service environment (or an override file)
RATE_LIMIT_MAX=100000

# host-run API
RATE_LIMIT_MAX=100000 pnpm --filter @surfgen/api dev
```

Rough budget: each `video-flow.js` iteration issues 2 + `POLL_ATTEMPTS`
requests, so `VUS × (2 + POLL_ATTEMPTS)` per iteration cycle must stay under
`RATE_LIMIT_MAX` per minute (the limiter keys per client IP — all k6 traffic
comes from one IP).
