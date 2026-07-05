import { describe, expect, test } from 'vitest';
import { redactTokenParam } from '../src/auth/mailer.service';

describe('redactTokenParam', () => {
  test('replaces the token query param value, leaving the rest of the URL readable', () => {
    // Arrange
    const url = 'http://localhost:3000/verify-email?token=sgv_supersecrettoken1234567890';

    // Act
    const redacted = redactTokenParam(url);

    // Assert
    expect(redacted).not.toContain('sgv_supersecrettoken1234567890');
    expect(redacted).toBe('http://localhost:3000/verify-email?token=%5Bredacted%5D');
  });

  test('leaves a URL with no token param unchanged', () => {
    expect(redactTokenParam('http://localhost:3000/verify-email')).toBe('http://localhost:3000/verify-email');
  });

  test('falls back to a fixed placeholder for an unparseable URL', () => {
    expect(redactTokenParam('not a url')).toBe('[unparseable url]');
  });
});
