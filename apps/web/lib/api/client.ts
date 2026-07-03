/**
 * Browser client for the SurfGen API (apps/api).
 *
 * - unwraps the { success, data, error, meta } envelope
 * - access token lives ONLY in memory; the refresh token is an httpOnly
 *   SameSite=Strict cookie scoped to /v1/auth — nothing auth-related ever
 *   touches localStorage (XSS cannot exfiltrate a session)
 * - page loads restore the session via one silent cookie refresh
 * - all failures surface as ApiError with the stable domain error code
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string } | null;
  meta: { cursor?: string | null; hasMore?: boolean } | null;
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function isAuthed(): boolean {
  return accessToken !== null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

function setAccessToken(token: string | null): void {
  accessToken = token;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('surfgen:auth'));
}

async function parseEnvelope<T>(response: Response): Promise<Envelope<T>> {
  try {
    return (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError('BAD_RESPONSE', `non-JSON response (${response.status})`);
  }
}

/** Auth endpoints are the only calls that carry the session cookie. */
function authFetch(path: string, body: unknown = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Single-flight cookie refresh — concurrent 401s share one rotation. */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await authFetch('/v1/auth/refresh');
      const envelope = await parseEnvelope<{ accessToken: string }>(response);
      if (!envelope.success) return false;
      setAccessToken(envelope.data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Restore the session after a page load; true when a token is (now) held. */
export async function ensureSession(): Promise<boolean> {
  if (accessToken) return true;
  return refreshSession();
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  retryOnAuth = true,
): Promise<{ data: T; meta: Envelope<T>['meta'] }> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(accessToken && { authorization: `Bearer ${accessToken}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  if (response.status === 401 && retryOnAuth) {
    if (await refreshSession()) return api<T>(method, path, body, false);
    setAccessToken(null); // refresh chain dead — force re-login
  }

  const envelope = await parseEnvelope<T>(response);
  if (!envelope.success || envelope.error) {
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'request failed');
  }
  return { data: envelope.data, meta: envelope.meta };
}

export async function login(email: string, password: string): Promise<void> {
  const response = await authFetch('/v1/auth/login', { email, password });
  const envelope = await parseEnvelope<{ accessToken: string }>(response);
  if (!envelope.success || envelope.error) {
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'login failed');
  }
  setAccessToken(envelope.data.accessToken);
}

export function logout(): void {
  // Cookie identifies the refresh token server-side; revoke + clear it.
  void authFetch('/v1/auth/logout').catch(() => undefined);
  setAccessToken(null);
}
