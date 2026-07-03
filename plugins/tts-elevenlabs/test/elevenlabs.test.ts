import { describe, expect, test } from 'vitest';
import { ElevenLabsTTSProvider } from '../src/index.js';

const FAKE_MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4]);

const elevenFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const key = new Headers(init?.headers).get('xi-api-key');
  if (key !== 'el-test-key') return new Response('unauthorized', { status: 401 });
  if (url.includes('/v1/user')) return new Response('{}', { status: 200 });
  if (url.includes('/v1/text-to-speech/')) {
    return new Response(FAKE_MP3.buffer.slice(0), { status: 200 });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

describe('ElevenLabsTTSProvider', () => {
  test('requires apiKey secret', async () => {
    const provider = new ElevenLabsTTSProvider('tts-elevenlabs', elevenFetch);
    await expect(
      provider.initialize({
        id: 'tts-elevenlabs',
        capability: 'tts',
        enabled: true,
        priority: 20,
        options: {},
      }),
    ).rejects.toThrow(/apiKey required/);
  });

  test('synthesizes audio bytes and emits progress before output', async () => {
    process.env.TEST_ELEVEN_KEY = 'el-test-key';
    const provider = new ElevenLabsTTSProvider('tts-elevenlabs', elevenFetch);
    await provider.initialize({
      id: 'tts-elevenlabs',
      capability: 'tts',
      enabled: true,
      priority: 20,
      options: { secrets: { apiKey: 'env:TEST_ELEVEN_KEY' } },
    });

    const events: string[] = [];
    let final: { audio: { sizeBytes?: number; contentType: string } } | null = null;
    for await (const event of provider.generate(
      { text: 'hello world', voiceId: 'rachel' },
      {},
    )) {
      events.push(event.type);
      if (event.type === 'output') final = event.data;
    }
    expect(events.filter((e) => e === 'progress').length).toBeGreaterThan(0);
    expect(final?.audio.contentType).toBe('audio/mpeg');
    expect(final?.audio.sizeBytes).toBe(FAKE_MP3.length);
    delete process.env.TEST_ELEVEN_KEY;
  });

  test('health check fails with a bad key', async () => {
    process.env.TEST_ELEVEN_KEY = 'wrong-key';
    const provider = new ElevenLabsTTSProvider('tts-elevenlabs', (async () =>
      new Response('unauthorized', { status: 401 })) as typeof fetch);
    await provider.initialize({
      id: 'tts-elevenlabs',
      capability: 'tts',
      enabled: true,
      priority: 20,
      options: { secrets: { apiKey: 'env:TEST_ELEVEN_KEY' } },
    });
    expect((await provider.health()).healthy).toBe(false);
    delete process.env.TEST_ELEVEN_KEY;
  });
});
