import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ConfigurationError } from '@surfgen/core';
import { maskSecret, openSecret, sealSecret } from '../src/common/secret-box';

const KEY = Buffer.alloc(32, 7).toString('base64');

beforeEach(() => {
  process.env.SURFGEN_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  delete process.env.SURFGEN_ENCRYPTION_KEY;
});

describe('secret-box', () => {
  test('seals and opens a secret round-trip', () => {
    // Arrange + Act
    const sealed = sealSecret('sk_test_abcdef123456');

    // Assert
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('sk_test');
    expect(openSecret(sealed)).toBe('sk_test_abcdef123456');
  });

  test('two seals of the same value differ (fresh IV each time)', () => {
    expect(sealSecret('same')).not.toBe(sealSecret('same'));
  });

  test('rejects a tampered ciphertext', () => {
    // Arrange
    const sealed = sealSecret('sk_test_abcdef123456');
    const parts = sealed.split(':');
    const flipped = Buffer.from(parts[3]!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    parts[3] = flipped.toString('base64');

    // Act + Assert
    expect(() => openSecret(parts.join(':'))).toThrow(ConfigurationError);
  });

  test('throws ConfigurationError when the master key is missing', () => {
    delete process.env.SURFGEN_ENCRYPTION_KEY;
    expect(() => sealSecret('x')).toThrow(ConfigurationError);
  });

  test('masks a secret to its last 4 characters', () => {
    expect(maskSecret('sk_live_abcdef7890')).toBe('••••7890');
  });
});
