import { describe, expect, test } from 'vitest';
import { collectFinalOutput } from '@surfgen/ai-sdk';
import { OllamaLLMProvider } from '../src/index.js';

const ollamaFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith('/api/version')) return new Response('{"version":"0.9.0"}', { status: 200 });
  if (url.endsWith('/api/chat')) {
    return new Response(
      JSON.stringify({
        message: { content: 'Once upon a GPU…' },
        done_reason: 'stop',
        prompt_eval_count: 12,
        eval_count: 34,
      }),
      { status: 200 },
    );
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

async function makeProvider() {
  const provider = new OllamaLLMProvider('llm-ollama', ollamaFetch);
  await provider.initialize({
    id: 'llm-ollama',
    capability: 'llm',
    enabled: true,
    priority: 10,
    options: { model: 'llama3.1' },
  });
  return provider;
}

describe('OllamaLLMProvider', () => {
  test('generates text and records token usage', async () => {
    const provider = await makeProvider();
    const usage: Array<[string, number]> = [];
    const output = await collectFinalOutput(
      provider.generate(
        { messages: [{ role: 'user', content: 'write a story' }] },
        { recordUsage: (metric, quantity) => usage.push([metric, quantity]) },
      ),
    );
    expect(output.text).toBe('Once upon a GPU…');
    expect(output.finishReason).toBe('stop');
    expect(output.usage).toEqual({ promptTokens: 12, completionTokens: 34 });
    expect(usage).toEqual([['llm.tokens', 46]]);
  });

  test('reports healthy against the version endpoint and local deployment', async () => {
    const provider = await makeProvider();
    expect((await provider.health()).healthy).toBe(true);
    expect(provider.capabilities().deployment).toBe('local');
  });
});
