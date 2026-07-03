/**
 * Browser client for the SurfGen API (apps/api).
 *
 * - unwraps the { success, data, error, meta } envelope
 * - stores rotating JWT pairs in localStorage; one auto refresh-and-retry on 401
 * - all failures surface as ApiError with the stable domain error code
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TOKEN_KEY = 'surfgen.tokens';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  error: { code: string; message: string } | null;
  meta: { cursor?: string | null; hasMore?: boolean } | null;
}

export function loadTokens(): TokenPair | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
  } catch {
    return null;
  }
}

export function saveTokens(tokens: TokenPair | null): void {
  if (typeof window === 'undefined') return;
  if (tokens) window.localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  else window.localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event('surfgen:auth'));
}

async function parseEnvelope<T>(response: Response): Promise<Envelope<T>> {
  try {
    return (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError('BAD_RESPONSE', `non-JSON response (${response.status})`);
  }
}

async function refresh(tokens: TokenPair): Promise<TokenPair | null> {
  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });
  const envelope = await parseEnvelope<TokenPair>(response);
  if (!envelope.success) return null;
  saveTokens(envelope.data);
  return envelope.data;
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  retryOnAuth = true,
): Promise<{ data: T; meta: Envelope<T>['meta'] }> {
  const tokens = loadTokens();
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(tokens && { authorization: `Bearer ${tokens.accessToken}` }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

  if (response.status === 401 && retryOnAuth && tokens) {
    const rotated = await refresh(tokens);
    if (rotated) return api<T>(method, path, body, false);
    saveTokens(null); // refresh chain dead — force re-login
  }

  const envelope = await parseEnvelope<T>(response);
  if (!envelope.success || envelope.error) {
    throw new ApiError(envelope.error?.code ?? 'UNKNOWN', envelope.error?.message ?? 'request failed');
  }
  return { data: envelope.data, meta: envelope.meta };
}

export async function login(email: string, password: string): Promise<void> {
  const { data } = await api<TokenPair>('POST', '/v1/auth/login', { email, password });
  saveTokens(data);
}

export function logout(): void {
  const tokens = loadTokens();
  if (tokens) {
    void fetch(`${API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    }).catch(() => undefined);
  }
  saveTokens(null);
}
