import { describe, expect, test } from 'vitest';
import { assertSafeUrl, isPublicUnicast } from '../src/index.js';
import { ValidationError } from '@surfgen/core';

describe('isPublicUnicast (SSRF guard)', () => {
  test.each([
    // classic private / loopback / special-purpose v4
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0',
    '100.64.0.1', // CGNAT 100.64/10
    '198.18.0.1', // benchmark 198.18/15
    '224.0.0.1', // multicast
    '240.0.0.1', // reserved
    '255.255.255.255',
    // v6 local + embedded-v4 bypasses
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:10.0.0.1', // IPv4-mapped private
    '2002:7f00:0001::', // 6to4
    // garbage
    'not-an-ip',
    '999.1.1.1',
  ])('rejects %s', (address) => {
    expect(isPublicUnicast(address)).toBe(false);
  });

  test.each(['1.1.1.1', '8.8.8.8', '93.184.215.14', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public %s',
    (address) => {
      expect(isPublicUnicast(address)).toBe(true);
    },
  );
});

describe('assertSafeUrl (outbound URL policy)', () => {
  test.each([
    'ftp://example.com/file',
    'file:///etc/passwd',
    'gopher://example.com',
    'https://example.com:8443/hook', // non-default port
    'http://example.com:4000/hook',
    'https://user:pass@example.com/hook', // embedded credentials
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertSafeUrl(url)).toThrow(ValidationError);
  });

  test.each([
    'https://example.com/hooks/surfgen',
    'http://example.com/hook',
    'https://example.com:443/hook',
    'http://example.com:80/hook',
  ])('allows %s', (url) => {
    expect(assertSafeUrl(url)).toBeInstanceOf(URL);
  });
});
