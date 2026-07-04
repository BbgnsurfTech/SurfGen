// SurfGen end-to-end video generation flow (k6).
//
// Per VU (once):   register-or-login -> resolve org -> find-or-create project
// Per iteration:   create video -> POST :videoId/generate -> poll video status
//
// Endpoints (URI-versioned, envelope { success, data, error, meta? }):
//   POST /v1/auth/login | /v1/auth/register
//   GET  /v1/orgs
//   GET/POST /v1/orgs/:orgId/projects
//   POST /v1/orgs/:orgId/projects/:projectId/videos
//   POST /v1/orgs/:orgId/projects/:projectId/videos/:videoId/generate
//   GET  /v1/orgs/:orgId/projects/:projectId/videos/:videoId
//
// This script asserts API behavior only: 2xx statuses and envelope shape.
// A terminal video status of 'failed' is TOLERATED — on a zero-credential
// stack (no cloud AI providers configured) renders may fail or stall, and
// that is not a load-test failure. Render success is the chaos suite's job.
//
// Run:
//   k6 run tests/load/video-flow.js
//   k6 run -e BASE_URL=http://localhost:4000 -e VUS=3 -e DURATION=2m \
//          -e EMAIL=me@example.com -e PASSWORD='longpassword-12' tests/load/video-flow.js
//
// When EMAIL is unset each VU registers its own throwaway user, which also
// provisions a personal workspace (org) for that VU.

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const EMAIL = __ENV.EMAIL || '';
// RegisterSchema requires >= 12 characters.
const PASSWORD = __ENV.PASSWORD || 'k6-video-flow-pw-123';
const PROJECT_NAME = __ENV.PROJECT_NAME || 'k6-load-project';
const POLL_ATTEMPTS = Number(__ENV.POLL_ATTEMPTS || 15);
const POLL_INTERVAL_SECONDS = Number(__ENV.POLL_INTERVAL_SECONDS || 2);

export const options = {
  vus: Number(__ENV.VUS || 3),
  duration: __ENV.DURATION || '2m',
  thresholds: {
    // Polling multiplies request volume: watch RATE_LIMIT_MAX (see README.md).
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1500'],
    checks: ['rate>0.95'],
  },
};

const TERMINAL_STATUSES = ['ready', 'failed', 'cancelled'];
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Per-VU session cache (k6 gives each VU its own module scope).
let session = null;

function parseEnvelope(res) {
  try {
    const body = res.json();
    return body && body.success === true && body.error === null ? body : null;
  } catch (_err) {
    return null;
  }
}

function authHeaders(extra) {
  return { headers: Object.assign({ Authorization: `Bearer ${session.token}` }, extra || {}) };
}

function registerOrLogin() {
  if (EMAIL) {
    const login = http.post(
      `${BASE_URL}/v1/auth/login`,
      JSON.stringify({ email: EMAIL, password: PASSWORD }),
      { headers: JSON_HEADERS },
    );
    const env = parseEnvelope(login);
    if (login.status === 200 && env) return env.data.accessToken;
  }
  const email = EMAIL || `k6-vu${__VU}-${Date.now()}@surfgen.local`;
  const register = http.post(
    `${BASE_URL}/v1/auth/register`,
    JSON.stringify({ email, password: PASSWORD, name: `k6 VU ${__VU}` }),
    { headers: JSON_HEADERS },
  );
  const env = parseEnvelope(register);
  check(register, { 'register-or-login succeeded': () => register.status === 201 && env !== null });
  return env ? env.data.accessToken : null;
}

/** GET /v1/orgs — registration guarantees at least the personal workspace. */
function resolveOrgId() {
  const res = http.get(`${BASE_URL}/v1/orgs`, authHeaders());
  const env = parseEnvelope(res);
  const ok = res.status === 200 && env !== null && Array.isArray(env.data) && env.data.length > 0;
  check(res, { 'list orgs succeeded': () => ok });
  return ok ? env.data[0].id : null;
}

/** Reuse PROJECT_NAME when it already exists, otherwise create it. */
function findOrCreateProject(orgId) {
  const list = http.get(`${BASE_URL}/v1/orgs/${orgId}/projects?limit=100`, authHeaders());
  const listEnvelope = parseEnvelope(list);
  if (list.status === 200 && listEnvelope && Array.isArray(listEnvelope.data)) {
    const existing = listEnvelope.data.find((p) => p.name === PROJECT_NAME);
    if (existing) return existing.id;
  }
  const created = http.post(
    `${BASE_URL}/v1/orgs/${orgId}/projects`,
    JSON.stringify({ name: PROJECT_NAME, description: 'k6 load-test project' }),
    authHeaders(JSON_HEADERS),
  );
  const env = parseEnvelope(created);
  check(created, { 'create project succeeded': () => created.status === 201 && env !== null });
  return env ? env.data.id : null;
}

function ensureSession() {
  if (session) return true;
  const token = registerOrLogin();
  if (!token) return false;
  session = { token };
  session.orgId = resolveOrgId();
  if (!session.orgId) {
    session = null;
    return false;
  }
  session.projectId = findOrCreateProject(session.orgId);
  if (!session.projectId) {
    session = null;
    return false;
  }
  return true;
}

export default function () {
  if (!ensureSession()) {
    sleep(2);
    return;
  }
  const videosUrl = `${BASE_URL}/v1/orgs/${session.orgId}/projects/${session.projectId}/videos`;

  // 1. Create a draft video. Providing a script skips the script-generation
  //    stage; `settings` is omitted so the server default (1080p/30/mp4) applies.
  const createRes = http.post(
    videosUrl,
    JSON.stringify({
      title: `k6 video vu${__VU} iter${__ITER}`,
      language: 'en',
      script: 'Hello from the SurfGen k6 load test. This is a short scripted render.',
    }),
    authHeaders(JSON_HEADERS),
  );
  const createEnvelope = parseEnvelope(createRes);
  check(createRes, {
    'create video is 201': (r) => r.status === 201,
    'create video envelope has id + draft status': () =>
      createEnvelope !== null &&
      typeof createEnvelope.data.id === 'string' &&
      createEnvelope.data.status === 'draft',
  });
  if (!createEnvelope) {
    sleep(2);
    return;
  }
  const videoId = createEnvelope.data.id;

  // 2. Enqueue generation — returns { video, runId }.
  const generateRes = http.post(`${videosUrl}/${videoId}/generate`, null, authHeaders());
  const generateEnvelope = parseEnvelope(generateRes);
  check(generateRes, {
    'generate is 201': (r) => r.status === 201,
    'generate envelope has runId + queued video': () =>
      generateEnvelope !== null &&
      typeof generateEnvelope.data.runId === 'string' &&
      generateEnvelope.data.video.status === 'queued',
  });
  if (!generateEnvelope) {
    sleep(2);
    return;
  }

  // 3. Poll the video until a terminal status or the attempt budget runs out.
  //    Only API behavior is asserted; 'failed' is an acceptable terminal state.
  let lastStatus = 'queued';
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    sleep(POLL_INTERVAL_SECONDS);
    const pollRes = http.get(`${videosUrl}/${videoId}`, authHeaders());
    const pollEnvelope = parseEnvelope(pollRes);
    const ok = pollRes.status === 200 && pollEnvelope !== null;
    check(pollRes, { 'poll video returns 200 + envelope': () => ok });
    if (!ok) break;
    lastStatus = pollEnvelope.data.status;
    if (TERMINAL_STATUSES.includes(lastStatus)) break;
  }
  check(null, {
    // Reaching any known status — including 'failed' — proves the pipeline API
    // accepted and tracked the run. Non-terminal after the budget is fine too
    // (renders can outlive the polling window); we only flag unknown statuses.
    'video status is a known pipeline status': () =>
      TERMINAL_STATUSES.concat([
        'draft',
        'queued',
        'generating',
        'rendering',
        'post_processing',
      ]).includes(lastStatus),
  });
}
