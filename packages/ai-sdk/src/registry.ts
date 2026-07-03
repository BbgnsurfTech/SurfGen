import { ProviderUnavailableError, ProviderError } from '@surfgen/core';
import type { Capability } from './capability.js';
import type { AIProvider, GenerationContext, HealthStatus, ProviderEvent } from './provider.js';

export interface RegistryEntry {
  readonly provider: AIProvider;
  readonly priority: number;
  enabled: boolean;
}

export interface ResolveOptions {
  readonly organizationId?: string;
  /** Restrict to a deployment class (data-residency policies). */
  readonly deployment?: 'cloud' | 'local' | 'self_hosted';
  /** Require a specific provider id (explicit user selection). */
  readonly providerId?: string;
  readonly language?: string;
}

export interface RegistryOptions {
  /** How long a health result is trusted before re-checking. */
  readonly healthTtlMs?: number;
  /** How long an unhealthy provider is skipped before re-probing. */
  readonly unhealthyCooldownMs?: number;
  readonly clock?: () => number;
  readonly onHealthChange?: (providerId: string, capability: Capability, healthy: boolean) => void;
}

interface HealthCacheEntry {
  status: HealthStatus;
  expiresAt: number;
}

const DEFAULT_HEALTH_TTL_MS = 30_000;
const DEFAULT_UNHEALTHY_COOLDOWN_MS = 60_000;

/**
 * Central provider directory. Resolution algorithm:
 *   1. candidates = enabled providers for capability, filtered by options
 *      (deployment class, explicit providerId, per-org override, language)
 *   2. order by per-org override first, then ascending priority
 *   3. health-gate each candidate (cached health with TTL + cooldown)
 *   4. first healthy candidate wins; execute() walks the whole chain on failure
 */
export class ProviderRegistry {
  private readonly entries = new Map<Capability, RegistryEntry[]>();
  private readonly orgOverrides = new Map<string, Map<Capability, string>>();
  private readonly healthCache = new Map<string, HealthCacheEntry>();
  private readonly healthTtlMs: number;
  private readonly unhealthyCooldownMs: number;
  private readonly clock: () => number;
  private readonly onHealthChange?: RegistryOptions['onHealthChange'];

  constructor(options: RegistryOptions = {}) {
    this.healthTtlMs = options.healthTtlMs ?? DEFAULT_HEALTH_TTL_MS;
    this.unhealthyCooldownMs = options.unhealthyCooldownMs ?? DEFAULT_UNHEALTHY_COOLDOWN_MS;
    this.clock = options.clock ?? Date.now;
    this.onHealthChange = options.onHealthChange;
  }

  register(provider: AIProvider, options: { priority?: number; enabled?: boolean } = {}): void {
    const list = this.entries.get(provider.capability) ?? [];
    if (list.some((e) => e.provider.id === provider.id)) {
      throw new ProviderError(provider.id, 'already registered', { retryable: false });
    }
    list.push({
      provider,
      priority: options.priority ?? 100,
      enabled: options.enabled ?? true,
    });
    list.sort((a, b) => a.priority - b.priority);
    this.entries.set(provider.capability, list);
  }

  async unregister(providerId: string): Promise<boolean> {
    for (const [capability, list] of this.entries) {
      const index = list.findIndex((e) => e.provider.id === providerId);
      if (index >= 0) {
        const [entry] = list.splice(index, 1);
        this.entries.set(capability, list);
        this.healthCache.delete(providerId);
        await entry?.provider.shutdown();
        return true;
      }
    }
    return false;
  }

  setEnabled(providerId: string, enabled: boolean): boolean {
    for (const list of this.entries.values()) {
      const entry = list.find((e) => e.provider.id === providerId);
      if (entry) {
        entry.enabled = enabled;
        return true;
      }
    }
    return false;
  }

  /** Pin a capability to a specific provider for one organization. */
  setOrgOverride(organizationId: string, capability: Capability, providerId: string): void {
    const map = this.orgOverrides.get(organizationId) ?? new Map();
    map.set(capability, providerId);
    this.orgOverrides.set(organizationId, map);
  }

  clearOrgOverride(organizationId: string, capability: Capability): void {
    this.orgOverrides.get(organizationId)?.delete(capability);
  }

  list(capability?: Capability): AIProvider[] {
    if (capability) return (this.entries.get(capability) ?? []).map((e) => e.provider);
    return [...this.entries.values()].flat().map((e) => e.provider);
  }

  /** Ordered, filtered (but not health-gated) candidate chain. */
  candidates(capability: Capability, options: ResolveOptions = {}): AIProvider[] {
    let list = (this.entries.get(capability) ?? []).filter((e) => e.enabled);

    if (options.providerId) {
      list = list.filter((e) => e.provider.id === options.providerId);
    }
    if (options.deployment) {
      list = list.filter((e) => e.provider.capabilities().deployment === options.deployment);
    }
    if (options.language) {
      list = list.filter((e) => {
        const langs = e.provider.capabilities().languages;
        if (langs.length === 0) return true; // language-agnostic
        const primary = options.language!.split('-')[0];
        return langs.some((l) => l === options.language || l.split('-')[0] === primary);
      });
    }

    const providers = list.map((e) => e.provider);
    const override = options.organizationId
      ? this.orgOverrides.get(options.organizationId)?.get(capability)
      : undefined;
    if (override) {
      // Overridden provider jumps to the front if it is a valid candidate.
      providers.sort((a, b) => Number(b.id === override) - Number(a.id === override));
    }
    return providers;
  }

  /** First healthy provider in the chain. */
  async resolve(capability: Capability, options: ResolveOptions = {}): Promise<AIProvider> {
    const chain = this.candidates(capability, options);
    for (const provider of chain) {
      if (await this.isHealthy(provider)) return provider;
    }
    throw new ProviderUnavailableError(capability, {
      details: { candidates: chain.map((p) => p.id) },
    });
  }

  /**
   * Execute with failover: walk the healthy chain; if a provider fails BEFORE
   * emitting any output event, try the next one. After first output, the
   * attempt is committed — a mid-stream switch would splice outputs from
   * different models into one artifact.
   */
  async *execute<TIn, TOut>(
    capability: Capability,
    input: TIn,
    context: GenerationContext,
    options: ResolveOptions = {},
  ): AsyncIterable<ProviderEvent<TOut>> {
    const chain = this.candidates(capability, options);
    const failures: { providerId: string; error: unknown }[] = [];

    for (const provider of chain) {
      if (!(await this.isHealthy(provider))) continue;

      let outputStarted = false;
      try {
        const typed = provider as AIProvider<TIn, TOut>;
        for await (const event of typed.generate(input, context)) {
          if (event.type === 'output') outputStarted = true;
          yield event;
        }
        return;
      } catch (error) {
        this.markUnhealthy(provider, error);
        if (outputStarted || context.signal?.aborted) throw error;
        failures.push({ providerId: provider.id, error });
      }
    }

    throw new ProviderUnavailableError(capability, {
      details: {
        attempted: failures.map((f) => f.providerId),
        errors: failures.map((f) => String(f.error)),
      },
    });
  }

  async isHealthy(provider: AIProvider): Promise<boolean> {
    const now = this.clock();
    const cached = this.healthCache.get(provider.id);
    if (cached && cached.expiresAt > now) return cached.status.healthy;

    const wasHealthy = cached?.status.healthy;
    let status: HealthStatus;
    try {
      status = await provider.health();
    } catch (error) {
      status = { healthy: false, reason: String(error), checkedAt: new Date(now) };
    }
    this.healthCache.set(provider.id, {
      status,
      expiresAt: now + (status.healthy ? this.healthTtlMs : this.unhealthyCooldownMs),
    });
    if (wasHealthy !== undefined && wasHealthy !== status.healthy) {
      this.onHealthChange?.(provider.id, provider.capability, status.healthy);
    }
    return status.healthy;
  }

  private markUnhealthy(provider: AIProvider, error: unknown): void {
    const now = this.clock();
    const wasHealthy = this.healthCache.get(provider.id)?.status.healthy;
    this.healthCache.set(provider.id, {
      status: { healthy: false, reason: String(error), checkedAt: new Date(now) },
      expiresAt: now + this.unhealthyCooldownMs,
    });
    if (wasHealthy !== false) {
      this.onHealthChange?.(provider.id, provider.capability, false);
    }
  }

  async shutdown(): Promise<void> {
    const all = [...this.entries.values()].flat();
    await Promise.allSettled(all.map((e) => e.provider.shutdown()));
    this.entries.clear();
    this.healthCache.clear();
    this.orgOverrides.clear();
  }
}
