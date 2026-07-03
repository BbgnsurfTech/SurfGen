import { describe, expect, test } from 'vitest';
import { ProviderRegistry } from '../src/registry.js';
import { MockProvider } from '../src/testing/mock-provider.js';
import { collectFinalOutput } from '../src/provider.js';
import type { ProviderEvent } from '../src/provider.js';

const ctx = { correlationId: 'test' };

async function drain<T>(stream: AsyncIterable<ProviderEvent<T>>): Promise<ProviderEvent<T>[]> {
  const events: ProviderEvent<T>[] = [];
  for await (const e of stream) events.push(e);
  return events;
}

describe('ProviderRegistry — registration', () => {
  test('rejects duplicate provider ids', () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider({ id: 'a', capability: 'tts' }));
    expect(() => registry.register(new MockProvider({ id: 'a', capability: 'tts' }))).toThrow(
      /already registered/,
    );
  });

  test('unregister shuts the provider down', async () => {
    const registry = new ProviderRegistry();
    const provider = new MockProvider({ id: 'a', capability: 'tts' });
    registry.register(provider);
    expect(await registry.unregister('a')).toBe(true);
    expect(provider.shutdownCalled).toBe(true);
    expect(registry.list('tts')).toHaveLength(0);
  });
});

describe('ProviderRegistry — resolution', () => {
  test('lowest priority number wins', async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider({ id: 'fallback', capability: 'tts' }), { priority: 50 });
    registry.register(new MockProvider({ id: 'primary', capability: 'tts' }), { priority: 10 });
    expect((await registry.resolve('tts')).id).toBe('primary');
  });

  test('disabled providers are skipped', async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider({ id: 'primary', capability: 'tts' }), { priority: 10 });
    registry.register(new MockProvider({ id: 'fallback', capability: 'tts' }), { priority: 50 });
    registry.setEnabled('primary', false);
    expect((await registry.resolve('tts')).id).toBe('fallback');
  });

  test('unhealthy providers are skipped (health-gated failover)', async () => {
    const registry = new ProviderRegistry();
    const primary = new MockProvider({ id: 'primary', capability: 'tts', healthy: false });
    registry.register(primary, { priority: 10 });
    registry.register(new MockProvider({ id: 'fallback', capability: 'tts' }), { priority: 50 });
    expect((await registry.resolve('tts')).id).toBe('fallback');
  });

  test('throws ProviderUnavailableError when no candidate is healthy', async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider({ id: 'a', capability: 'tts', healthy: false }));
    await expect(registry.resolve('tts')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  test('per-organization override jumps the queue', async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider({ id: 'default', capability: 'tts' }), { priority: 10 });
    registry.register(new MockProvider({ id: 'pinned', capability: 'tts' }), { priority: 90 });
    registry.setOrgOverride('org_1', 'tts', 'pinned');

    expect((await registry.resolve('tts', { organizationId: 'org_1' })).id).toBe('pinned');
    expect((await registry.resolve('tts', { organizationId: 'org_2' })).id).toBe('default');

    registry.clearOrgOverride('org_1', 'tts');
    expect((await registry.resolve('tts', { organizationId: 'org_1' })).id).toBe('default');
  });

  test('deployment filter restricts to local providers', async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockProvider({ id: 'cloud', capability: 'tts', deployment: 'cloud' }), {
      priority: 10,
    });
    registry.register(new MockProvider({ id: 'local', capability: 'tts', deployment: 'local' }), {
      priority: 50,
    });
    expect((await registry.resolve('tts', { deployment: 'local' })).id).toBe('local');
  });

  test('language filter matches primary subtag; empty languages = agnostic', async () => {
    const registry = new ProviderRegistry();
    registry.register(
      new MockProvider({ id: 'en-only', capability: 'tts', languages: ['en-US'] }),
      { priority: 10 },
    );
    registry.register(new MockProvider({ id: 'any', capability: 'tts', languages: [] }), {
      priority: 50,
    });
    expect((await registry.resolve('tts', { language: 'en-GB' })).id).toBe('en-only');
    expect((await registry.resolve('tts', { language: 'ja' })).id).toBe('any');
  });
});

describe('ProviderRegistry — execute with failover', () => {
  test('fails over to next provider when first throws before output', async () => {
    const registry = new ProviderRegistry();
    const flaky = new MockProvider<string, string>({
      id: 'flaky',
      capability: 'tts',
      failFirst: 1,
    });
    const stable = new MockProvider<string, string>({
      id: 'stable',
      capability: 'tts',
      produce: (input) => `stable:${input}`,
    });
    registry.register(flaky, { priority: 10 });
    registry.register(stable, { priority: 50 });

    const result = await collectFinalOutput(registry.execute<string, string>('tts', 'hello', ctx));
    expect(result).toBe('stable:hello');
    expect(flaky.calls).toBe(1);
    expect(stable.calls).toBe(1);
  });

  test('failed provider is marked unhealthy for subsequent resolves', async () => {
    const clock = { now: 0 };
    const registry = new ProviderRegistry({ clock: () => clock.now, unhealthyCooldownMs: 1000 });
    const flaky = new MockProvider<string, string>({ id: 'flaky', capability: 'tts', failFirst: 1 });
    const stable = new MockProvider<string, string>({ id: 'stable', capability: 'tts' });
    registry.register(flaky, { priority: 10 });
    registry.register(stable, { priority: 50 });

    await drain(registry.execute<string, string>('tts', 'x', ctx));
    expect((await registry.resolve('tts')).id).toBe('stable'); // cooldown active

    clock.now = 2000; // cooldown expired → primary re-probed and healthy again
    expect((await registry.resolve('tts')).id).toBe('flaky');
  });

  test('no failover after output has started', async () => {
    const registry = new ProviderRegistry();
    const midStreamFailure: AsyncIterable<ProviderEvent<string>> = (async function* () {
      yield { type: 'output', data: 'partial', final: false } as const;
      throw new Error('mid-stream break');
    })();
    const broken = new MockProvider<string, string>({ id: 'broken', capability: 'tts' });
    broken.generate = () => midStreamFailure;
    const stable = new MockProvider<string, string>({ id: 'stable', capability: 'tts' });
    registry.register(broken, { priority: 10 });
    registry.register(stable, { priority: 50 });

    await expect(drain(registry.execute<string, string>('tts', 'x', ctx))).rejects.toThrow(
      'mid-stream break',
    );
    expect(stable.calls).toBe(0);
  });

  test('progress events pass through to the consumer', async () => {
    const registry = new ProviderRegistry();
    registry.register(
      new MockProvider<string, string>({ id: 'p', capability: 'tts', progressSteps: 3 }),
    );
    const events = await drain(registry.execute<string, string>('tts', 'x', ctx));
    expect(events.filter((e) => e.type === 'progress')).toHaveLength(3);
    expect(events.at(-1)).toMatchObject({ type: 'output', final: true });
  });

  test('health change callback fires on transitions', async () => {
    const transitions: Array<{ id: string; healthy: boolean }> = [];
    const registry = new ProviderRegistry({
      healthTtlMs: 0,
      onHealthChange: (id, _cap, healthy) => transitions.push({ id, healthy }),
    });
    const provider = new MockProvider({ id: 'p', capability: 'tts' });
    registry.register(provider);

    await registry.isHealthy(provider); // first check — no transition recorded
    provider.setHealthy(false);
    await registry.isHealthy(provider);
    expect(transitions).toEqual([{ id: 'p', healthy: false }]);
  });
});
