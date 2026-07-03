import type { Capability, CapabilityDescriptor } from '../capability.js';
import type {
  AIProvider,
  GenerationContext,
  HealthStatus,
  ProviderConfig,
  ProviderEvent,
} from '../provider.js';

export interface MockProviderOptions<TIn, TOut> {
  readonly id: string;
  readonly capability: Capability;
  readonly deployment?: 'cloud' | 'local' | 'self_hosted';
  readonly languages?: readonly string[];
  /** Produce the output for an input; throw to simulate failure. */
  readonly produce?: (input: TIn, context: GenerationContext) => Promise<TOut> | TOut;
  /** Simulated health; mutable via setHealthy(). */
  readonly healthy?: boolean;
  /** Fail this many generate() calls before succeeding (failover tests). */
  readonly failFirst?: number;
  /** Emit N progress events before output. */
  readonly progressSteps?: number;
}

/** Deterministic in-memory provider for tests and the zero-credential demo path. */
export class MockProvider<TIn = unknown, TOut = unknown> implements AIProvider<TIn, TOut> {
  readonly id: string;
  readonly capability: Capability;
  calls = 0;
  initialized = false;
  shutdownCalled = false;
  private healthy: boolean;
  private remainingFailures: number;

  constructor(private readonly options: MockProviderOptions<TIn, TOut>) {
    this.id = options.id;
    this.capability = options.capability;
    this.healthy = options.healthy ?? true;
    this.remainingFailures = options.failFirst ?? 0;
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  async initialize(_config: ProviderConfig): Promise<void> {
    this.initialized = true;
  }

  async health(): Promise<HealthStatus> {
    return { healthy: this.healthy, latencyMs: 1, checkedAt: new Date() };
  }

  capabilities(): CapabilityDescriptor {
    return {
      capability: this.capability,
      displayName: `Mock ${this.capability} (${this.id})`,
      deployment: this.options.deployment ?? 'local',
      streaming: true,
      languages: this.options.languages ?? [],
      inputFormats: [],
      outputFormats: [],
      features: { mock: true },
    };
  }

  async *generate(input: TIn, context: GenerationContext): AsyncIterable<ProviderEvent<TOut>> {
    this.calls += 1;
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error(`${this.id}: simulated failure`);
    }
    const steps = this.options.progressSteps ?? 0;
    for (let i = 1; i <= steps; i++) {
      yield { type: 'progress', percent: Math.round((i / (steps + 1)) * 100) };
    }
    const produce = this.options.produce ?? ((value: TIn) => value as unknown as TOut);
    yield { type: 'output', data: await produce(input, context), final: true };
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }
}
