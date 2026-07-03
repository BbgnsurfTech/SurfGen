import { describe, expect, test } from 'vitest';
import {
  all,
  andThen,
  err,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  tryCatch,
  tryCatchAsync,
  unwrap,
  unwrapOr,
} from '../src/result.js';

describe('Result', () => {
  test('ok wraps a value and reports success', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    expect(r.value).toBe(42);
  });

  test('err wraps an error and reports failure', () => {
    const r = err(new Error('boom'));
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  test('map transforms ok values and passes errors through', () => {
    expect(unwrap(map(ok(2), (n) => n * 2))).toBe(4);
    const failure = err(new Error('x'));
    expect(map(failure, (n: number) => n * 2)).toBe(failure);
  });

  test('mapErr transforms errors and passes ok through', () => {
    const mapped = mapErr(err(new Error('a')), (e) => new Error(`${e.message}b`));
    expect(isErr(mapped) && mapped.error.message).toBe('ab');
    const success = ok(1);
    expect(mapErr(success, () => new Error('nope'))).toBe(success);
  });

  test('andThen chains ok and short-circuits on err', () => {
    const parse = (s: string) => {
      const n = Number(s);
      return Number.isNaN(n) ? err(new Error('NaN')) : ok(n);
    };
    expect(unwrap(andThen(ok('5'), parse))).toBe(5);
    expect(isErr(andThen(ok('x'), parse))).toBe(true);
  });

  test('unwrap throws the contained error', () => {
    expect(() => unwrap(err(new Error('boom')))).toThrow('boom');
    expect(() => unwrap(err('string error'))).toThrow('string error');
  });

  test('unwrapOr falls back on error', () => {
    expect(unwrapOr(err(new Error('x')), 7)).toBe(7);
    expect(unwrapOr(ok(1), 7)).toBe(1);
  });

  test('all collects values or returns first error', () => {
    expect(unwrap(all([ok(1), ok(2), ok(3)]))).toEqual([1, 2, 3]);
    const failure = err(new Error('second'));
    expect(all([ok(1), failure, err(new Error('third'))])).toBe(failure);
  });

  test('tryCatch captures thrown errors', () => {
    expect(unwrap(tryCatch(() => 1))).toBe(1);
    const r = tryCatch(() => {
      throw new Error('sync boom');
    });
    expect(isErr(r) && r.error.message).toBe('sync boom');
  });

  test('tryCatchAsync captures rejections', async () => {
    expect(unwrap(await tryCatchAsync(async () => 'ok'))).toBe('ok');
    const r = await tryCatchAsync(async () => {
      throw new Error('async boom');
    });
    expect(isErr(r) && r.error.message).toBe('async boom');
  });
});
