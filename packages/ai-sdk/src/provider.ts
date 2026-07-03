import type { Capability, CapabilityDescriptor } from './capability.js';

export interface ProviderConfig {
  /** Unique instance id, e.g. "tts-elevenlabs" or "tts-piper-local". */
  readonly id: string;
  readonly capability: Capability;
  readonly enabled: boolean;
  /** Lower number wins when multiple providers serve a capability. */
  readonly priority: number;
  /** Provider-specific options (endpoint, model, apiKeyRef, …). Secrets are
   *  referenced by name (resolved via secret manager), never inlined. */
  readonly options: Readonly<Record<string, unknown>>;
}

export interface HealthStatus {
  readonly healthy: boolean;
  readonly latencyMs?: number;
  readonly reason?: string;
  readonly checkedAt: Date;
}

export interface GenerationContext {
  readonly organizationId?: string;
  readonly correlationId?: string;
  /** Cooperative cancellation — providers must abort work when signalled. */
  readonly signal?: AbortSignal;
  /** Emit usage for billing: metric like 'tts.characters', quantity. */
  readonly recordUsage?: (metric: string, quantity: number) => void;
}

/** Events yielded by generate(). A run is: progress* → output+ → (end of stream), or error. */
export type ProviderEvent<TOut = unknown> =
  | { readonly type: 'progress'; readonly percent: number; readonly message?: string }
  | { readonly type: 'output'; readonly data: TOut; readonly final: boolean }
  | { readonly type: 'log'; readonly level: 'debug' | 'info' | 'warn'; readonly message: string };

/**
 * The single contract every AI provider implements. TIn/TOut are the
 * capability-specific payload types from ./capabilities.
 */
export interface AIProvider<TIn = unknown, TOut = unknown> {
  readonly id: string;
  readonly capability: Capability;
  initialize(config: ProviderConfig): Promise<void>;
  health(): Promise<HealthStatus>;
  capabilities(): CapabilityDescriptor;
  generate(input: TIn, context: GenerationContext): AsyncIterable<ProviderEvent<TOut>>;
  shutdown(): Promise<void>;
}

/** Convenience: drain a generate() stream and return the final output. */
export async function collectFinalOutput<TOut>(
  stream: AsyncIterable<ProviderEvent<TOut>>,
): Promise<TOut> {
  let last: { value: TOut } | null = null;
  for await (const event of stream) {
    if (event.type === 'output') last = { value: event.data };
  }
  if (!last) throw new Error('Provider stream ended without an output event');
  return last.value;
}

/** Convenience for providers whose work is a single async call. */
export async function* singleOutput<TOut>(promise: Promise<TOut>): AsyncIterable<ProviderEvent<TOut>> {
  yield { type: 'output', data: await promise, final: true };
}
