import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ConfigurationError } from '@surfgen/core';

/**
 * Seals small secrets (payment gateway keys) for at-rest storage in Postgres.
 * AES-256-GCM with a master key from SURFGEN_ENCRYPTION_KEY (32 bytes,
 * base64 or hex). Sealed format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */

const VERSION = 'v1';
const IV_BYTES = 12;

function masterKey(): Buffer {
  const raw = process.env.SURFGEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new ConfigurationError(
      'SURFGEN_ENCRYPTION_KEY is not set — required to store payment gateway secrets',
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new ConfigurationError('SURFGEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function sealSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

export function openSecret(sealed: string): string {
  const [version, ivB64, tagB64, dataB64] = sealed.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new ConfigurationError('Sealed secret has an unrecognized format');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString(
      'utf8',
    );
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError('Sealed secret failed to decrypt (wrong key or tampered data)', {
      cause: error,
    });
  }
}

/** Display-safe fingerprint — enough for an admin to recognize the stored key. */
export function maskSecret(plaintext: string): string {
  return `••••${plaintext.slice(-4)}`;
}
