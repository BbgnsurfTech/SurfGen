import { describe, expect, test } from 'vitest';
import { maxRequestsFor } from '../src/common/rate-limit-config';

describe('maxRequestsFor', () => {
  test.each(['/v1/auth/login', '/v1/auth/register', '/v1/auth/resend-verification', '/v1/auth/refresh'])(
    'applies the strict limit to %s',
    (path) => {
      expect(maxRequestsFor(path, 300, 10)).toBe(10);
    },
  );

  test('strips a query string before matching', () => {
    expect(maxRequestsFor('/v1/auth/login?redirect=/dashboard', 300, 10)).toBe(10);
  });

  test('applies the default limit to unrelated routes', () => {
    expect(maxRequestsFor('/v1/orgs', 300, 10)).toBe(300);
  });

  test('does not strictly limit routes that merely share a prefix', () => {
    expect(maxRequestsFor('/v1/auth/logout', 300, 10)).toBe(300);
    expect(maxRequestsFor('/v1/auth/me', 300, 10)).toBe(300);
  });
});
