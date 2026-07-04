# Chaos tests

## `kill-worker.sh` — worker crash mid-render

Proves the pipeline's **retry/resume guarantees**: a render survives a hard
`SIGKILL` of every worker replica mid-run and still completes.

### What it proves (grounded in the actual implementation)

- **All run state lives in Postgres, not in the worker.** The orchestrator
  (`apps/workers/pipeline/src/orchestrator.ts`) is stateless: `PipelineRun`
  rows hold the DAG definition, per-stage artifacts, and status; killing the
  process loses nothing.
- **Jobs are idempotent by ID.** Every stage job is enqueued with
  `jobId = runId:stage`, so when the restarted orchestrator re-derives ready
  stages, double-enqueues are no-ops.
- **BullMQ recovers the interrupted stage.** A job that was `active` when the
  worker died becomes *stalled*; BullMQ's stalled-checker (~30s interval)
  moves it back to waiting, where it retries with **exponential backoff (5s
  base)** against the per-stage attempt budget
  (`packages/queue/src/bull-queue.ts`: `attempts: maxAttempts ?? 3`;
  per-stage `maxAttempts` in `pipelines/default-video.ts` ranges 2–5).
- **Events resume too.** Orchestrator subscriptions use named durable queues
  (`orchestrator.*`), so `pipeline.stage_completed`/`stage_failed` events
  published while the worker is down are delivered after restart.
- **Optional stages degrade instead of failing** (`translate`, `subtitles`,
  `thumbnail` are `optional: true` — a failure records a skipped artifact and
  unblocks dependents); non-optional stage exhaustion fails the run, which
  the script reports as a genuine failure.

### Prerequisites

- `docker` with compose v2, `jq`, `curl`
- The **full** stack running (the worker must be containerized — the dev
  compose file has no worker service):

```bash
JWT_SECRET=$(openssl rand -hex 32) \
  docker compose -f infra/docker/docker-compose.full.yml up --build -d
curl -fsS http://localhost:4000/healthz
```

The script verifies each prerequisite and exits with a clear message when one
is missing (docker/jq absent, compose file missing, API down, no running
`worker` container).

### Run it

```bash
./tests/chaos/kill-worker.sh

# knobs (env vars)
BASE_URL=http://localhost:4000 \
COMPOSE_FILE=infra/docker/docker-compose.full.yml \
WORKER_SERVICE=worker \
ACTIVE_TIMEOUT_SECONDS=120 COMPLETE_TIMEOUT_SECONDS=420 \
./tests/chaos/kill-worker.sh
```

### Expected output

```text
[chaos] stack is up (2 worker container(s) running)
[chaos] registering chaos-1719…@surfgen.local
[chaos] org: …            project: …           video: …
[chaos] pipeline run started: <runId>
[chaos] waiting for the run to go active (timeout 120s)…
[chaos] run is active (video status: generating)
[chaos] killing worker (SIGKILL, all replicas) mid-run…
[chaos] worker down; video status at kill: generating
[chaos] restarting worker…
[chaos] waiting for the run to complete (timeout 420s)…      <- ~30s+ pause here is
[chaos] video reached 'ready' (pipeline run: completed) …       BullMQ stalled-job recovery
[chaos] retry/resume PROVEN: stalled-job recovery + jobId dedupe + DB-persisted run state carried the run to completion
```

Exit code 0 on success; non-zero with a diagnostic message otherwise.

### WORKER_QUEUES caveat (read this if the run never goes active / stalls)

The default pipeline routes the `tts` and `avatar` stages to `gpu.default`
(`apps/workers/pipeline/src/pipelines/default-video.ts`). A worker only
serves the queues listed in its `WORKER_QUEUES` env var — if none serves the
gpu classes, runs sit at `generating` forever and the script times out.
`docker-compose.full.yml` ships with all six resource classes enabled (the
"gpu" queues are scheduling labels; the local reference providers run on
CPU), and the worker's host default — when `WORKER_QUEUES` is unset — also
includes them. If you split workers across pools, make sure at least one
serves `gpu.default` and `gpu.heavy` before running this script.
