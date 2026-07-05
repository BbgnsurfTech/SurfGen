import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { deriveSecret, getJwtSecret } from '../src/common/jwt-secret';

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  delete process.env.JWT_SECRET;
  delete process.env.NODE_ENV;
});

afterEach(() => {
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe('getJwtSecret', () => {
  test('returns the configured secret regardless of NODE_ENV', () => {
    // Arrange
    process.env.JWT_SECRET = 'real-secret';
    process.env.NODE_ENV = 'production';

    // Act + Assert
    expect(getJwtSecret()).toBe('real-secret');
  });

  test('falls back to the dev secret in development', () => {
    process.env.NODE_ENV = 'development';
    expect(getJwtSecret()).toBe('surfgen-dev-secret-do-not-use-in-prod');
  });

  test('falls back to the dev secret in test', () => {
    process.env.NODE_ENV = 'test';
    expect(getJwtSecret()).toBe('surfgen-dev-secret-do-not-use-in-prod');
  });

  test('fails closed when unset and NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => getJwtSecret()).toThrow('JWT_SECRET must be set');
  });

  test('fails closed when unset and NODE_ENV is unset entirely', () => {
    // The exact gap the audit flagged: no NODE_ENV set at all (a common
    // misconfiguration on a first deploy) must not silently use the dev secret.
    expect(() => getJwtSecret()).toThrow('JWT_SECRET must be set');
  });

  test('fails closed when unset and NODE_ENV is an unrecognized value', () => {
    process.env.NODE_ENV = 'staging';
    expect(() => getJwtSecret()).toThrow('JWT_SECRET must be set');
  });
});

describe('deriveSecret', () => {
  test('derives distinct secrets per label from the same JWT secret', () => {
    process.env.JWT_SECRET = 'root-secret';
    expect(deriveSecret('media')).not.toBe(deriveSecret('other'));
  });

  test('is deterministic for the same label and secret', () => {
    process.env.JWT_SECRET = 'root-secret';
    expect(deriveSecret('media')).toBe(deriveSecret('media'));
  });
});
