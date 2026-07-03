import { describe, expect, test } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { EnvelopeInterceptor } from '../src/common/envelope.interceptor';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import { z } from 'zod';

describe('password hashing', () => {
  test('round-trip verification', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(verifyPassword('wrong password', stored)).toBe(false);
  });

  test('unique salts per hash', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  test('rejects malformed stored values', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(verifyPassword('x', 'bcrypt:aa:bb')).toBe(false);
  });
});

describe('EnvelopeInterceptor', () => {
  const interceptor = new EnvelopeInterceptor();
  const run = (value: unknown) =>
    firstValueFrom(interceptor.intercept({} as never, { handle: () => of(value) }));

  test('wraps bare values', async () => {
    expect(await run({ id: 'v1' })).toEqual({ success: true, data: { id: 'v1' }, error: null });
    expect(await run(undefined)).toEqual({ success: true, data: null, error: null });
  });

  test('lifts { data, meta } into the envelope', async () => {
    expect(await run({ data: [1, 2], meta: { cursor: 'abc' } })).toEqual({
      success: true,
      data: [1, 2],
      error: null,
      meta: { cursor: 'abc' },
    });
  });
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ name: z.string().min(1) }));

  test('passes valid input through with parsing applied', () => {
    expect(pipe.transform({ name: 'ok', extra: 'stripped' })).toEqual({ name: 'ok' });
  });

  test('throws BadRequest with structured issues', () => {
    try {
      pipe.transform({ name: '' });
      expect.unreachable();
    } catch (error) {
      const response = (error as { getResponse: () => Record<string, unknown> }).getResponse();
      expect(response.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(response.issues)).toBe(true);
    }
  });
});
