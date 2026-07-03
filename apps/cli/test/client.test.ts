import { describe, expect, test } from 'vitest';
import { ApiError, SurfGenClient, type CliConfig } from '../src/client.js';

function makeFetch(handler: (url: string, init: RequestInit) => Response): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init ?? {})) as typeof fetch;
}

const baseConfig: CliConfig = { apiUrl: 'http://api.test' };

describe('SurfGenClient', () => {
  test('unwraps the response envelope', async () => {
    const client = new SurfGenClient(
      baseConfig,
      makeFetch(() =>
        new Response(JSON.stringify({ success: true, data: { id: 'v1' }, error: null }), {
          status: 200,
        }),
      ),
    );
    const { data } = await client.request<{ id: string }>('GET', '/v1/videos');
    expect(data).toEqual({ id: 'v1' });
  });

  test('throws ApiError with the envelope error code', async () => {
    const client = new SurfGenClient(
      baseConfig,
      makeFetch(() =>
        new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: { code: 'QUOTA_EXCEEDED', message: 'over limit' },
          }),
          { status: 402 },
        ),
      ),
    );
    await expect(client.request('POST', '/v1/videos')).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      status: 402,
    });
    await expect(client.request('POST', '/v1/videos')).rejects.toBeInstanceOf(ApiError);
  });

  test('sends bearer token, prefers api key when present', async () => {
    const seen: string[] = [];
    const fetchImpl = makeFetch((_url, init) => {
      const headers = new Headers(init.headers);
      seen.push(headers.get('authorization') ?? headers.get('x-api-key') ?? 'none');
      return new Response(JSON.stringify({ success: true, data: null, error: null }), {
        status: 200,
      });
    });

    await new SurfGenClient({ ...baseConfig, accessToken: 'tok' }, fetchImpl).request('GET', '/x');
    await new SurfGenClient(
      { ...baseConfig, accessToken: 'tok', apiKey: 'sg_key' },
      fetchImpl,
    ).request('GET', '/x');
    expect(seen).toEqual(['Bearer tok', 'sg_key']);
  });

  test('auto-refreshes once on 401 then replays the request', async () => {
    let calls = 0;
    const fetchImpl = makeFetch((url) => {
      calls += 1;
      if (url.endsWith('/v1/auth/refresh')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
            error: null,
          }),
          { status: 200 },
        );
      }
      if (calls === 1) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ success: true, data: { ok: true }, error: null }), {
        status: 200,
      });
    });

    // saveConfig writes to ~/.surfgen — redirect HOME to a temp dir for the test.
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const originalHome = process.env.HOME;
    process.env.HOME = mkdtempSync(join(tmpdir(), 'surfgen-cli-'));

    try {
      const client = new SurfGenClient(
        { ...baseConfig, accessToken: 'stale', refreshToken: 'refresh-1' },
        fetchImpl,
      );
      const { data } = await client.request<{ ok: boolean }>('GET', '/v1/orgs');
      expect(data).toEqual({ ok: true });
      expect(client.currentConfig.accessToken).toBe('new-access');
    } finally {
      process.env.HOME = originalHome;
    }
  });
});
