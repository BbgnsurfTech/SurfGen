import { describe, expect, test } from 'vitest';
import { DEFAULT_HTTP_PROBES, ModelDiscoveryService } from '../src/discovery.js';

/** fetch stub: only the given endpoints respond. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    throw new Error(`ECONNREFUSED ${url}`);
  }) as typeof fetch;
}

describe('ModelDiscoveryService', () => {
  test('discovers responding runtimes and extracts model lists', async () => {
    const service = new ModelDiscoveryService({
      cliProbes: [], // no CLI probing in unit tests
      fetchImpl: fakeFetch({
        'http://127.0.0.1:11434': { models: [{ name: 'llama3.1' }, { name: 'mistral' }] },
        'http://127.0.0.1:8188': { system: {} },
      }),
    });
    const runtimes = await service.discover();
    const ids = runtimes.map((runtime) => runtime.id).sort();
    expect(ids).toEqual(['comfyui', 'ollama']);
    expect(runtimes.find((r) => r.id === 'ollama')?.models).toEqual(['llama3.1', 'mistral']);
    expect(runtimes.find((r) => r.id === 'comfyui')?.capability).toBe('image_generation');
  });

  test('absent runtimes are omitted, not errors', async () => {
    const service = new ModelDiscoveryService({ cliProbes: [], fetchImpl: fakeFetch({}) });
    expect(await service.discover()).toEqual([]);
  });

  test('model endpoint failure still reports the runtime', async () => {
    const probe = DEFAULT_HTTP_PROBES.find((p) => p.id === 'ollama')!;
    const service = new ModelDiscoveryService({
      httpProbes: [probe],
      cliProbes: [],
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/api/version')) return new Response('{}', { status: 200 });
        throw new Error('tags endpoint down');
      }) as typeof fetch,
    });
    const runtimes = await service.discover();
    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]?.models).toEqual([]);
  });

  test('cli probe finds ffmpeg-like binaries via injected probe', async () => {
    // 'node --version' exits 0 everywhere the test suite runs.
    const service = new ModelDiscoveryService({
      httpProbes: [],
      cliProbes: [
        { id: 'node-as-ffmpeg', capability: 'multi', command: 'node', versionArgs: ['--version'] },
        { id: 'missing-bin', capability: 'tts', command: 'definitely-not-a-command-xyz', versionArgs: ['--version'] },
      ],
    });
    const runtimes = await service.discover();
    expect(runtimes.map((r) => r.id)).toEqual(['node-as-ffmpeg']);
  });
});
