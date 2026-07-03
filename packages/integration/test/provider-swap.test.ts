import { describe, expect, test } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ProviderRegistry, collectFinalOutput, type LLMInput, type LLMOutput } from '@surfgen/ai-sdk';
import { AiConfigSchema, type AiConfig } from '@surfgen/config';
import { OllamaLLMProvider } from '@surfgen/plugin-llm-ollama';
import { OpenAILLMProvider } from '@surfgen/plugin-llm-openai';
import mockSuite from '@surfgen/plugin-mock-suite';

/**
 * PHASE 3 GATE — the headline platform requirement:
 * the SAME application code serves a request from a cloud provider or a local
 * provider purely because ai.yaml changed. Nothing here names a vendor after
 * setup; the flow only asks the registry for the 'llm' capability.
 */

const CLOUD_FIRST_YAML = `
capabilities:
  llm:
    chain:
      - provider: llm-openai
        priority: 5
      - provider: llm-ollama
        priority: 10
      - provider: llm-mock
        priority: 100
`;

const LOCAL_FIRST_YAML = `
capabilities:
  llm:
    chain:
      - provider: llm-ollama
        priority: 5
      - provider: llm-openai
        priority: 10
      - provider: llm-mock
        priority: 100
`;

const LOCAL_ONLY_YAML = `
capabilities:
  llm:
    chain:
      - provider: llm-mock
        priority: 100
`;

// Deterministic fakes for both remote services.
const openaiFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith('/v1/models')) return new Response('{"data":[]}', { status: 200 });
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: 'served-by-openai' }, finish_reason: 'stop' }],
    }),
    { status: 200 },
  );
}) as typeof fetch;

const ollamaFetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.endsWith('/api/version')) return new Response('{}', { status: 200 });
  return new Response(JSON.stringify({ message: { content: 'served-by-ollama' } }), {
    status: 200,
  });
}) as typeof fetch;

/**
 * Host wiring, config-driven: build a registry whose priorities come ONLY from
 * the parsed ai.yaml chain. This mirrors what apps/api's provider module does.
 */
async function buildRegistryFromConfig(aiConfig: AiConfig): Promise<ProviderRegistry> {
  const registry = new ProviderRegistry();
  const chain = new Map(
    (aiConfig.capabilities.llm?.chain ?? []).map((entry) => [entry.provider, entry]),
  );

  const available: Record<string, () => Promise<void>> = {
    'llm-openai': async () => {
      process.env.SWAP_TEST_OPENAI_KEY = 'sk-test';
      const provider = new OpenAILLMProvider('llm-openai', openaiFetch);
      await provider.initialize({
        id: 'llm-openai',
        capability: 'llm',
        enabled: true,
        priority: chain.get('llm-openai')?.priority ?? 100,
        options: { secrets: { apiKey: 'env:SWAP_TEST_OPENAI_KEY' } },
      });
      registry.register(provider, { priority: chain.get('llm-openai')?.priority ?? 100 });
    },
    'llm-ollama': async () => {
      const provider = new OllamaLLMProvider('llm-ollama', ollamaFetch);
      await provider.initialize({
        id: 'llm-ollama',
        capability: 'llm',
        enabled: true,
        priority: chain.get('llm-ollama')?.priority ?? 100,
        options: {},
      });
      registry.register(provider, { priority: chain.get('llm-ollama')?.priority ?? 100 });
    },
    'llm-mock': async () => {
      await mockSuite.register(registry, {});
    },
  };

  for (const entry of chain.values()) {
    if (entry.enabled) await available[entry.provider]?.();
  }
  return registry;
}

/** The application flow under test — identical for every configuration. */
async function generateScript(registry: ProviderRegistry): Promise<string> {
  const output = await collectFinalOutput(
    registry.execute<LLMInput, LLMOutput>(
      'llm',
      { messages: [{ role: 'user', content: 'Write a 30s product intro script' }] },
      {},
    ),
  );
  return output.text;
}

const loadConfig = (yaml: string): AiConfig => AiConfigSchema.parse(parseYaml(yaml));

describe('GATE: provider swap via configuration only', () => {
  test('cloud-first config routes to OpenAI', async () => {
    const registry = await buildRegistryFromConfig(loadConfig(CLOUD_FIRST_YAML));
    expect(await generateScript(registry)).toBe('served-by-openai');
    await registry.shutdown();
  });

  test('local-first config routes the SAME flow to Ollama — zero code changes', async () => {
    const registry = await buildRegistryFromConfig(loadConfig(LOCAL_FIRST_YAML));
    expect(await generateScript(registry)).toBe('served-by-ollama');
    await registry.shutdown();
  });

  test('zero-credential config still succeeds via the mock chain', async () => {
    const registry = await buildRegistryFromConfig(loadConfig(LOCAL_ONLY_YAML));
    expect(await generateScript(registry)).toContain('[mock-llm]');
    await registry.shutdown();
  });

  test('cloud outage fails over to the next provider in the chain', async () => {
    // OpenAI configured first but its endpoint is down → Ollama serves.
    const brokenOpenAIFetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;

    const registry = new ProviderRegistry();
    process.env.SWAP_TEST_OPENAI_KEY = 'sk-test';
    const openai = new OpenAILLMProvider('llm-openai', brokenOpenAIFetch);
    await openai.initialize({
      id: 'llm-openai',
      capability: 'llm',
      enabled: true,
      priority: 5,
      options: { secrets: { apiKey: 'env:SWAP_TEST_OPENAI_KEY' } },
    });
    registry.register(openai, { priority: 5 });

    const ollama = new OllamaLLMProvider('llm-ollama', ollamaFetch);
    await ollama.initialize({
      id: 'llm-ollama',
      capability: 'llm',
      enabled: true,
      priority: 10,
      options: {},
    });
    registry.register(ollama, { priority: 10 });

    expect(await generateScript(registry)).toBe('served-by-ollama');
    await registry.shutdown();
  });
});
