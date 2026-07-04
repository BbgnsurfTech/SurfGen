#!/usr/bin/env bash
#
# Chaos test: kill the pipeline worker mid-render and prove the run resumes.
#
#   1. Register a throwaway user against the running API (curl + jq)
#   2. Create project + video, POST …/generate to start a pipeline run
#   3. Wait until the run is actively processing (video status 'generating')
#   4. docker compose kill worker        <- hard SIGKILL, mid-stage
#   5. docker compose up -d worker       <- restart
#   6. Poll until the video reaches 'ready' (BullMQ stalled-job recovery +
#      per-stage retries + the stateless orchestrator resume the DAG)
#
# Prerequisites: docker (with compose v2), jq, curl, and the full stack up:
#   JWT_SECRET=$(openssl rand -hex 32) \
#     docker compose -f infra/docker/docker-compose.full.yml up --build -d
#
# See tests/chaos/README.md for what this proves and the expected output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BASE_URL="${BASE_URL:-http://localhost:4000}"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/infra/docker/docker-compose.full.yml}"
WORKER_SERVICE="${WORKER_SERVICE:-worker}"           # service name in docker-compose.full.yml
ACTIVE_TIMEOUT_SECONDS="${ACTIVE_TIMEOUT_SECONDS:-120}"   # wait for the run to go active
COMPLETE_TIMEOUT_SECONDS="${COMPLETE_TIMEOUT_SECONDS:-420}" # wait for resume + completion
KILL_DELAY_SECONDS="${KILL_DELAY_SECONDS:-3}"        # let a stage get going before the kill
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-3}"

log()  { printf '\033[1;34m[chaos]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[chaos]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[chaos] FAIL:\033[0m %s\n' "$*" >&2; exit 1; }

# ----------------------------------------------------------- prerequisites
command -v curl >/dev/null 2>&1 || die "curl is required but not installed"
command -v jq   >/dev/null 2>&1 || die "jq is required but not installed (brew install jq / apt-get install jq)"
command -v docker >/dev/null 2>&1 || die "docker is required but not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required ('docker compose' subcommand not found)"
[ -f "${COMPOSE_FILE}" ] || die "compose file not found: ${COMPOSE_FILE}"

compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

if ! curl -fsS --max-time 5 "${BASE_URL}/healthz" >/dev/null 2>&1; then
  die "API not reachable at ${BASE_URL}/healthz — start the stack first:
  JWT_SECRET=\$(openssl rand -hex 32) docker compose -f ${COMPOSE_FILE} up --build -d"
fi

RUNNING_WORKERS="$(compose ps --status running --quiet "${WORKER_SERVICE}" 2>/dev/null | wc -l | tr -d ' ')"
[ "${RUNNING_WORKERS}" -ge 1 ] || die "no running '${WORKER_SERVICE}' container in the compose stack (docker compose -f ${COMPOSE_FILE} ps)"
log "stack is up (${RUNNING_WORKERS} ${WORKER_SERVICE} container(s) running)"

# ------------------------------------------------------------- API helpers
# api METHOD PATH [JSON_BODY] — prints the response body, dies on transport error.
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS --max-time 30 -X "${method}" -H 'Content-Type: application/json')
  [ -n "${TOKEN:-}" ] && args+=(-H "Authorization: Bearer ${TOKEN}")
  [ -n "${body}" ] && args+=(-d "${body}")
  curl "${args[@]}" "${BASE_URL}${path}" \
    || die "request failed: ${method} ${BASE_URL}${path}"
}

# require_success RESPONSE CONTEXT — asserts the {success,data,error} envelope.
require_success() {
  local response="$1" context="$2"
  if ! printf '%s' "${response}" | jq -e '.success == true' >/dev/null 2>&1; then
    die "${context}: $(printf '%s' "${response}" | jq -c '.error // .' 2>/dev/null || printf '%s' "${response}")"
  fi
}

# -------------------------------------------------------------- test setup
STAMP="$(date +%s)"
EMAIL="chaos-${STAMP}@surfgen.local"
PASSWORD="chaos-test-password-123"   # RegisterSchema: >= 12 chars

log "registering ${EMAIL}"
REGISTER="$(api POST /v1/auth/register "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"name\":\"Chaos Test\"}")"
require_success "${REGISTER}" "register"
TOKEN="$(printf '%s' "${REGISTER}" | jq -r '.data.accessToken')"
[ -n "${TOKEN}" ] && [ "${TOKEN}" != "null" ] || die "no accessToken in register response"

ORGS="$(api GET /v1/orgs)"
require_success "${ORGS}" "list orgs"
ORG_ID="$(printf '%s' "${ORGS}" | jq -r '.data[0].id')"
[ -n "${ORG_ID}" ] && [ "${ORG_ID}" != "null" ] || die "registration did not provision a personal workspace"
log "org: ${ORG_ID}"

PROJECT="$(api POST "/v1/orgs/${ORG_ID}/projects" '{"name":"chaos-kill-worker","description":"chaos test project"}')"
require_success "${PROJECT}" "create project"
PROJECT_ID="$(printf '%s' "${PROJECT}" | jq -r '.data.id')"
log "project: ${PROJECT_ID}"

VIDEOS_PATH="/v1/orgs/${ORG_ID}/projects/${PROJECT_ID}/videos"
VIDEO="$(api POST "${VIDEOS_PATH}" '{"title":"chaos kill-worker run","language":"en","script":"This scripted render exists to be interrupted. The worker will be killed mid-run and the pipeline must resume and complete."}')"
require_success "${VIDEO}" "create video"
VIDEO_ID="$(printf '%s' "${VIDEO}" | jq -r '.data.id')"
log "video: ${VIDEO_ID}"

GENERATE="$(api POST "${VIDEOS_PATH}/${VIDEO_ID}/generate")"
require_success "${GENERATE}" "generate"
RUN_ID="$(printf '%s' "${GENERATE}" | jq -r '.data.runId')"
log "pipeline run started: ${RUN_ID}"

video_status() {
  api GET "${VIDEOS_PATH}/${VIDEO_ID}" | jq -r '.data.status'
}

# ----------------------------------------------- wait until the run is live
log "waiting for the run to go active (timeout ${ACTIVE_TIMEOUT_SECONDS}s)…"
DEADLINE=$(( $(date +%s) + ACTIVE_TIMEOUT_SECONDS ))
STATUS="queued"
while [ "$(date +%s)" -lt "${DEADLINE}" ]; do
  STATUS="$(video_status)"
  case "${STATUS}" in
    generating|rendering|post_processing) break ;;
    failed|cancelled) die "run reached '${STATUS}' before the worker was killed — inspect worker logs: docker compose -f ${COMPOSE_FILE} logs ${WORKER_SERVICE}" ;;
  esac
  sleep "${POLL_INTERVAL_SECONDS}"
done
case "${STATUS}" in
  generating|rendering|post_processing) ;;
  *) die "run never went active within ${ACTIVE_TIMEOUT_SECONDS}s (status: ${STATUS}) — is the ${WORKER_SERVICE} healthy and serving the pipeline queues? (see README caveat about WORKER_QUEUES)" ;;
esac
ok "run is active (video status: ${STATUS})"
sleep "${KILL_DELAY_SECONDS}"

# ------------------------------------------------------------ kill + restart
log "killing ${WORKER_SERVICE} (SIGKILL, all replicas) mid-run…"
compose kill "${WORKER_SERVICE}" || die "docker compose kill ${WORKER_SERVICE} failed"
STATUS_AT_KILL="$(video_status)"
log "worker down; video status at kill: ${STATUS_AT_KILL}"

sleep 2
log "restarting ${WORKER_SERVICE}…"
compose up -d --no-build "${WORKER_SERVICE}" || die "docker compose up -d ${WORKER_SERVICE} failed"
ok "worker restarted"

# --------------------------------------------------- prove resume-to-complete
# BullMQ marks the killed stage's job as stalled (~30s stalled-checker
# interval), re-queues it against per-stage maxAttempts with exponential
# backoff (5s base), and the jobId 'runId:stage' dedupe means the restarted
# orchestrator cannot double-enqueue. Expect a pause, then completion.
log "waiting for the run to complete (timeout ${COMPLETE_TIMEOUT_SECONDS}s)…"
DEADLINE=$(( $(date +%s) + COMPLETE_TIMEOUT_SECONDS ))
STATUS="${STATUS_AT_KILL}"
while [ "$(date +%s)" -lt "${DEADLINE}" ]; do
  STATUS="$(video_status)"
  case "${STATUS}" in
    ready|failed|cancelled) break ;;
  esac
  sleep "${POLL_INTERVAL_SECONDS}"
done

RUN_STATUS="$(api GET "${VIDEOS_PATH}/${VIDEO_ID}" | jq -r '.data.pipelineRuns[0].status // "unknown"')"
case "${STATUS}" in
  ready)
    ok "video reached 'ready' (pipeline run: ${RUN_STATUS}) after the worker was killed and restarted"
    ok "retry/resume PROVEN: stalled-job recovery + jobId dedupe + DB-persisted run state carried the run to completion"
    exit 0
    ;;
  failed)
    die "run finished 'failed' after restart (pipeline run: ${RUN_STATUS}) — resume did not recover the interrupted stage; check: docker compose -f ${COMPOSE_FILE} logs ${WORKER_SERVICE}"
    ;;
  cancelled)
    die "run was cancelled — did something else touch video ${VIDEO_ID}?"
    ;;
  *)
    die "run did not reach a terminal state within ${COMPLETE_TIMEOUT_SECONDS}s (video: ${STATUS}, run: ${RUN_STATUS}).
  Raise COMPLETE_TIMEOUT_SECONDS, or check whether the compose worker serves the
  queues the pipeline needs (see 'WORKER_QUEUES caveat' in tests/chaos/README.md)."
    ;;
esac
