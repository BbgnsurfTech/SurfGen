import { describe, expect, test } from 'vitest';
import { collectFinalOutput } from '@surfgen/ai-sdk';
import { OpenAILLMProvider } from '../src/index.js';

const openaiFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const auth = new Headers(init?.headers).get('authorization');
  if (auth !== 'Bearer sk-test-123') return new Response('unauthorized', { status: 401 });
  if (url.endsWith('/v1/models')) return new Response('{"data":[]}', { status: 200 });
  if (url.endsWith('/v1/chat/completions')) {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: 'cloud response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 7 },
      }),
      { status: 200 },
    );
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const config = (secrets?: Record<string, string>) => ({
  id: 'llm-openai',
  capability: 'llm' as const,
  enabled: true,
  priority: 20,
  options: { secrets },
});

describe('OpenAILLMProvider', () => {
  test('requires an apiKey secret reference', async () => {
    const provider = new OpenAILLMProvider('llm-openai', openaiFetch);
    await expect(provider.initialize(config())).rejects.toThrow(/secrets\.apiKey is required/);
  });

  test('resolves env secret refs and generates', async () => {
    process.env.TEST_OPENAI_KEY = 'sk-test-123';
    const provider = new OpenAILLMProvider('llm-openai', openaiFetch);
    await provider.initialize(config({ apiKey: 'env:TEST_OPENAI_KEY' }));

    const output = await collectFinalOutput(
      provider.generate({ messages: [{ role: 'user', content: 'hi' }] }, {}),
    );
    expect(output.text).toBe('cloud response');
    expect(output.usage).toEqual({ promptTokens: 5, completionTokens: 7 });
    expect(provider.capabilities().deployment).toBe('cloud');
    delete process.env.TEST_OPENAI_KEY;
  });
});
