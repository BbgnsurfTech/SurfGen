// SurfGen load smoke test (k6).
//
// Exercises the cheapest full-auth path on every iteration:
//   GET  /healthz                     (public, unversioned)
//   POST /v1/auth/login               (envelope: { success, data, error })
//   GET  /v1/orgs                     (Bearer access token)
//
// Run (stack up via infra/docker/docker-compose.full.yml):
//   k6 run tests/load/smoke.js
//   k6 run -e BASE_URL=http://localhost:4000 -e VUS=2 -e DURATION=30s tests/load/smoke.js
//
// setup() registers the smoke user if it does not exist yet, so the script is
// self-sufficient against a freshly migrated database.

import http from 'k6/http';
import { check, sleep, fail } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const EMAIL = __ENV.EMAIL || 'k6-smoke@surfgen.local';
// AuthController RegisterSchema requires >= 12 characters.
const PASSWORD = __ENV.PASSWORD || 'k6-smoke-password-123';

export const options = {
  vus: Number(__ENV.VUS || 2),
  duration: __ENV.DURATION || '1m',
  thresholds: {
    // Keep well under RATE_LIMIT_MAX (default 300 req/min) — see README.md.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    checks: ['rate>0.99'],
  },
};

const JSON_PARAMS = { headers: { 'Content-Type': 'application/json' } };

function parseEnvelope(res) {
  try {
    const body = res.json();
    return body && body.success === true && body.error === null ? body : null;
  } catch (_err) {
    return null;
  }
}

/** Make sure the smoke user exists; registering also creates its personal workspace. */
export function setup() {
  const login = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    JSON_PARAMS,
  );
  if (login.status === 200) return;

  const register = http.post(
    `${BASE_URL}/v1/auth/register`,
    JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'k6 smoke user' }),
    JSON_PARAMS,
  );
  if (register.status !== 201) {
    fail(
      `setup: could not login (${login.status}) or register (${register.status}) ` +
        `${EMAIL} against ${BASE_URL} — is the stack up and migrated?`,
    );
  }
}

export default function () {
  // 1. Liveness — public, outside /v1 versioning.
  const health = http.get(`${BASE_URL}/healthz`);
  check(health, {
    'healthz is 200': (r) => r.status === 200,
    'healthz reports ok': (r) => {
      const env = parseEnvelope(r);
      return env !== null && env.data && env.data.status === 'ok';
    },
  });

  // 2. Login — bcrypt is intentionally slow; this is the expensive check.
  const login = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    JSON_PARAMS,
  );
  const loginEnvelope = parseEnvelope(login);
  check(login, {
    'login is 200': (r) => r.status === 200,
    'login returns envelope with tokens': () =>
      loginEnvelope !== null &&
      typeof loginEnvelope.data.accessToken === 'string' &&
      typeof loginEnvelope.data.refreshToken === 'string',
  });
  if (!loginEnvelope) {
    sleep(1);
    return;
  }

  // 3. List my organizations with the fresh access token.
  const orgs = http.get(`${BASE_URL}/v1/orgs`, {
    headers: { Authorization: `Bearer ${loginEnvelope.data.accessToken}` },
  });
  check(orgs, {
    'orgs is 200': (r) => r.status === 200,
    'orgs envelope carries an array': (r) => {
      const env = parseEnvelope(r);
      return env !== null && Array.isArray(env.data) && env.data.length >= 1;
    },
  });

  sleep(1);
}
