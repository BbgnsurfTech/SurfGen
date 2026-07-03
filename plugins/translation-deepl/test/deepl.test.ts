import { describe, expect, test } from 'vitest';
import { collectFinalOutput } from '@surfgen/ai-sdk';
import { DeepLTranslationProvider } from '../src/index.js';

let lastPayload: Record<string, unknown> = {};

const deeplFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/v2/usage')) return new Response('{}', { status: 200 });
  if (url.endsWith('/v2/translate')) {
    lastPayload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        translations: [{ text: 'Hallo Welt', detected_source_language: 'EN' }],
      }),
      { status: 200 },
    );
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

async function makeProvider() {
  process.env.TEST_DEEPL_KEY = 'deepl-key';
  const provider = new DeepLTranslationProvider('translation-deepl', deeplFetch);
  await provider.initialize({
    id: 'translation-deepl',
    capability: 'translation',
    enabled: true,
    priority: 20,
    options: { secrets: { apiKey: 'env:TEST_DEEPL_KEY' } },
  });
  return provider;
}

describe('DeepLTranslationProvider', () => {
  test('translates and lower-cases detected language', async () => {
    const provider = await makeProvider();
    const output = await collectFinalOutput(
      provider.generate({ text: 'Hello world', targetLanguage: 'de' }, {}),
    );
    expect(output.text).toBe('Hallo Welt');
    expect(output.detectedSourceLanguage).toBe('en');
    expect(lastPayload.target_lang).toBe('DE');
  });

  test('maps formality to DeepL vocabulary', async () => {
    const provider = await makeProvider();
    await collectFinalOutput(
      provider.generate(
        { text: 'Hey', targetLanguage: 'de', formality: 'formal' },
        {},
      ),
    );
    expect(lastPayload.formality).toBe('more');
  });
});
