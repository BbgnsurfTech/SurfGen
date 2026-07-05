import { describe, expect, test } from 'vitest';
import { hasRequiredScope, requiredApiKeyScope } from '../src/auth/guards';

describe('requiredApiKeyScope', () => {
  test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete'])('%s requires write', (method) => {
    expect(requiredApiKeyScope(method)).toBe('write');
  });

  test.each(['GET', 'HEAD', 'OPTIONS', 'get'])('%s requires read', (method) => {
    expect(requiredApiKeyScope(method)).toBe('read');
  });
});

describe('hasRequiredScope', () => {
  test('JWT principals (scopes undefined) are never restricted by this check', () => {
    expect(hasRequiredScope('DELETE', undefined)).toBe(true);
    expect(hasRequiredScope('GET', undefined)).toBe(true);
  });

  test('a read-only API key can call read routes but not mutating ones', () => {
    expect(hasRequiredScope('GET', ['read'])).toBe(true);
    expect(hasRequiredScope('POST', ['read'])).toBe(false);
    expect(hasRequiredScope('DELETE', ['read'])).toBe(false);
  });

  test('a write-scoped API key can call both read and mutating routes', () => {
    expect(hasRequiredScope('GET', ['read', 'write'])).toBe(true);
    expect(hasRequiredScope('POST', ['read', 'write'])).toBe(true);
  });

  test('an API key with only write scope cannot call read routes', () => {
    // Matches the taxonomy in developer.controller.ts's CreateApiKeySchema —
    // 'write' alone (no 'read') is a valid, if unusual, key configuration.
    expect(hasRequiredScope('GET', ['write'])).toBe(false);
  });

  test('an API key with no scopes at all is rejected for everything', () => {
    expect(hasRequiredScope('GET', [])).toBe(false);
    expect(hasRequiredScope('POST', [])).toBe(false);
  });
});
