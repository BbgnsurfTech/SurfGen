import { describe, expect, test } from 'vitest';
import { ProviderRegistry, collectFinalOutput } from '@surfgen/ai-sdk';
import { providerConformanceSuite } from '@surfgen/plugin-sdk/conformance';
import { MockProvider } from '@surfgen/ai-sdk';
import plugin from '../src/index.js';

describe('mock-suite plugin', () => {
  test('registers a mock provider for every declared capability', async () => {
    const registry = new ProviderRegistry();
    await plugin.register(registry, {});
    const byCapability = new Map(plugin.manifest.capabilities.map((c) => [c, 0]));
    for (const provider of registry.list()) {
      byCapability.set(provider.capability, (byCapability.get(provider.capability) ?? 0) + 1);
    }
    for (const capability of plugin.manifest.capabilities) {
      expect(byCapability.get(capability), `capability ${capability}`).toBeGreaterThan(0);
    }
  });

  test('mock tts output is deterministic and storage-key shaped', async () => {
    const registry = new ProviderRegistry();
    await plugin.register(registry, {});
    const output = await collectFinalOutput(
      registry.execute<{ text: string; voiceId: string }, { audio: { storageKey: string } }>(
        'tts',
        { text: 'hello', voiceId: 'amy' },
        {},
      ),
    );
    expect(output.audio.storageKey).toMatch(/^mock\/tts\/amy\//);
  });
});

// Conformance proof for the reference mock provider implementation.
providerConformanceSuite(
  'mock-provider-reference',
  () =>
    new MockProvider<{ text: string }, { echo: string }>({
      id: 'conformance-mock',
      capability: 'tts',
      progressSteps: 1,
      produce: (input) => ({ echo: input.text }),
    }),
  { sampleInput: { text: 'sample' } },
);
