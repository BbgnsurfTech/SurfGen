import { describe, expect, test } from 'vitest';
import { ListQuerySchema, pageResult } from '../src/common/list-query';

const row = (id: string) => ({ id });

describe('ListQuerySchema', () => {
  test('defaults limit to 20 with no cursor', () => {
    expect(ListQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  test('coerces the limit query string and caps it at 100', () => {
    expect(ListQuerySchema.parse({ limit: '50' }).limit).toBe(50);
    expect(() => ListQuerySchema.parse({ limit: '101' })).toThrow();
    expect(() => ListQuerySchema.parse({ limit: '0' })).toThrow();
  });
});

describe('pageResult', () => {
  test('returns all rows and a null cursor when under the limit', () => {
    const result = pageResult([row('a'), row('b')], 3);
    expect(result.data).toHaveLength(2);
    expect(result.meta.cursor).toBeNull();
  });

  test('trims the limit+1 sentinel row and points the cursor at the last returned row', () => {
    const result = pageResult([row('a'), row('b'), row('c'), row('d')], 3);
    expect(result.data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(result.meta.cursor).toBe('c');
  });

  test('returns an empty page with a null cursor for no rows', () => {
    expect(pageResult([], 20)).toEqual({ data: [], meta: { cursor: null } });
  });
});
