import { describe, expect, it } from 'vitest';
import type { AIProvider, ProviderConfig } from '@surfgen/ai-sdk';

export interface ConformanceOptions<TIn> {
  /** Minimal valid input for one generate() call. */
  readonly sampleInput: TIn;
  readonly config?: Partial<ProviderConfig>;
}

/**
 * Contract test every provider must pass. Plugins call this from their own
 * vitest suite:
 *
 *   providerConformanceSuite('tts-piper', () => makeProvider(), { sampleInput });
 */
export function providerConformanceSuite<TIn>(
  name: string,
  factory: () => Promise<AIProvider<TIn>> | AIProvider<TIn>,
  options: ConformanceOptions<TIn>,
): void {
  describe(`provider conformance: ${name}`, () => {
    const makeConfig = (provider: AIProvider): ProviderConfig => ({
      id: provider.id,
      capability: provider.capability,
      enabled: true,
      priority: 100,
      options: {},
      ...options.config,
    });

    it('initializes without error', async () => {
      const provider = await factory();
      await expect(provider.initialize(makeConfig(provider))).resolves.toBeUndefined();
      await provider.shutdown();
    });

    it('reports health with the required shape', async () => {
      const provider = await factory();
      await provider.initialize(makeConfig(provider));
      const health = await provider.health();
      expect(typeof health.healthy).toBe('boolean');
      expect(health.checkedAt).toBeInstanceOf(Date);
      await provider.shutdown();
    });

    it('publishes a coherent capability descriptor', async () => {
      const provider = await factory();
      await provider.initialize(makeConfig(provider));
      const descriptor = provider.capabilities();
      expect(descriptor.capability).toBe(provider.capability);
      expect(['cloud', 'local', 'self_hosted']).toContain(descriptor.deployment);
      expect(descriptor.displayName.length).toBeGreaterThan(0);
      expect(Array.isArray(descriptor.languages)).toBe(true);
      await provider.shutdown();
    });

    it('generate() yields at least one output and ends with final=true', async () => {
      const provider = await factory();
      await provider.initialize(makeConfig(provider));
      const outputs: { final: boolean }[] = [];
      for await (const event of provider.generate(options.sampleInput, {})) {
        if (event.type === 'output') outputs.push({ final: event.final });
        if (event.type === 'progress') {
          expect(event.percent).toBeGreaterThanOrEqual(0);
          expect(event.percent).toBeLessThanOrEqual(100);
        }
      }
      expect(outputs.length).toBeGreaterThan(0);
      expect(outputs.at(-1)?.final).toBe(true);
      await provider.shutdown();
    });

    it('respects a pre-aborted signal (throws or completes fast)', async () => {
      const provider = await factory();
      await provider.initialize(makeConfig(provider));
      const controller = new AbortController();
      controller.abort();
      const startedAt = Date.now();
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of provider.generate(options.sampleInput, {
          signal: controller.signal,
        })) {
          // draining
        }
      } catch {
        // throwing on abort is valid behavior
      }
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      await provider.shutdown();
    });

    it('shutdown() is idempotent', async () => {
      const provider = await factory();
      await provider.initialize(makeConfig(provider));
      await provider.shutdown();
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });
  });
}
