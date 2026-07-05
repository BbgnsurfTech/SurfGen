import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(secret: string, key: string, expires: number): string {
  return createHmac('sha256', secret).update(`${key}:${expires}`).digest('hex');
}

/** Produces the expires/sig query values for a time-limited local-media link. */
export function signMediaKey(
  secret: string,
  key: string,
  expiresInSeconds: number,
): { expires: number; sig: string } {
  const expires = Date.now() + expiresInSeconds * 1000;
  return { expires, sig: sign(secret, key, expires) };
}

/** Verifies a signature produced by signMediaKey. False if expired, tampered, or malformed. */
export function verifyMediaKey(secret: string, key: string, expires: number, sig: string): boolean {
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  let expected: Buffer;
  let provided: Buffer;
  try {
    expected = Buffer.from(sign(secret, key, expires), 'hex');
    provided = Buffer.from(sig, 'hex');
  } catch {
    return false;
  }
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
