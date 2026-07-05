import { createHash } from 'node:crypto';

const DEV_ONLY_NODE_ENVS = new Set(['development', 'test']);

/**
 * Shared JWT signing/verification secret. Fails closed by default: only an
 * explicit NODE_ENV of 'development' or 'test' is allowed to fall back to the
 * well-known dev value. Unset, mistyped, or unrecognized NODE_ENV values
 * (staging, a forgotten env var, a typo'd 'Production') all require a real
 * secret — a deployment must opt into the dev fallback, never default to it.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (DEV_ONLY_NODE_ENVS.has(process.env.NODE_ENV ?? '')) {
    return 'surfgen-dev-secret-do-not-use-in-prod';
  }
  throw new Error("JWT_SECRET must be set (NODE_ENV must be 'development' or 'test' to use the dev fallback)");
}

/** Derives a purpose-specific secret from the JWT secret so keys aren't reused across primitives. */
export function deriveSecret(label: string): string {
  return createHash('sha256').update(`${label}:${getJwtSecret()}`).digest('hex');
}
