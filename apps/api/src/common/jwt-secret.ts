import { createHash } from 'node:crypto';

/**
 * Shared JWT signing/verification secret. Falls back to a well-known dev
 * value outside production — every consumer of this function inherits that
 * risk until JWT_SECRET is made mandatory outside development too.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return secret ?? 'surfgen-dev-secret-do-not-use-in-prod';
}

/** Derives a purpose-specific secret from the JWT secret so keys aren't reused across primitives. */
export function deriveSecret(label: string): string {
  return createHash('sha256').update(`${label}:${getJwtSecret()}`).digest('hex');
}
