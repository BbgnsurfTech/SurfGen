/**
 * Endpoints where the default global rate limit (hundreds/minute) is far too
 * loose to slow down credential stuffing, account enumeration, or
 * verification-email spam. These get a much stricter per-IP limit.
 */
const STRICT_AUTH_PATHS = new Set([
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/resend-verification',
  '/v1/auth/refresh',
]);

/** Resolves the effective rate-limit ceiling for a request URL. */
export function maxRequestsFor(url: string, defaultMax: number, strictAuthMax: number): number {
  const path = url.split('?')[0] ?? url;
  return STRICT_AUTH_PATHS.has(path) ? strictAuthMax : defaultMax;
}
