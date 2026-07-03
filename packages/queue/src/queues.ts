import type { JobQueueName } from '@surfgen/core';

export interface QueueDefinition {
  readonly concurrencyDefault: number;
  readonly description: string;
}

/**
 * Resource-class queue split: GPU stages never contend with CPU media work,
 * and IO fan-out (webhooks/analytics) never blocks rendering.
 */
export const QUEUE_DEFINITIONS: Record<JobQueueName, QueueDefinition> = {
  'cpu.default': { concurrencyDefault: 8, description: 'General CPU stages (script, subtitles)' },
  'cpu.media': { concurrencyDefault: 2, description: 'FFmpeg render/compress/thumbnail' },
  'gpu.default': { concurrencyDefault: 1, description: 'Single-GPU inference (tts, lipsync)' },
  'gpu.heavy': { concurrencyDefault: 1, description: 'Multi-GPU / long inference (video gen)' },
  'io.webhooks': { concurrencyDefault: 16, description: 'Webhook delivery' },
  'io.analytics': { concurrencyDefault: 16, description: 'Usage + analytics fan-out' },
};

const BULL_PREFIX = 'surfgen:';

export const queueNameToBullName = (name: JobQueueName): string => `${BULL_PREFIX}${name}`;

export const bullNameToQueueName = (bullName: string): JobQueueName | null => {
  if (!bullName.startsWith(BULL_PREFIX)) return null;
  const name = bullName.slice(BULL_PREFIX.length) as JobQueueName;
  return name in QUEUE_DEFINITIONS ? name : null;
};
