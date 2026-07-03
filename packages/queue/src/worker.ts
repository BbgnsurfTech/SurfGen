import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { JobQueueName } from '@surfgen/core';
import type { Logger, MetricsRegistry } from '@surfgen/telemetry';
import { cancellationKey, type CancellationKV, type RedisLike } from './bull-queue.js';
import { QUEUE_DEFINITIONS, queueNameToBullName } from './queues.js';
import { clampPercent } from './progress.js';

const CANCELLATION_POLL_MS = 2_000;

export interface StageJobContext<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  readonly attempt: number;
  updateProgress(percent: number, message?: string, checkpoint?: Record<string, unknown>): Promise<void>;
  isCancellationRequested(): Promise<boolean>;
  /** Aborts when a cancellation flag is detected (polled). */
  readonly signal: AbortSignal;
}

export interface StageWorkerOptions<T> {
  readonly queue: JobQueueName;
  readonly connection: ConnectionOptions;
  readonly handler: (context: StageJobContext<T>) => Promise<unknown>;
  readonly concurrency?: number;
  readonly logger: Logger;
  readonly metrics?: MetricsRegistry;
  readonly prefix?: string;
  readonly kv?: CancellationKV;
}

/**
 * Stage worker wrapper: progress protocol, cooperative cancellation (via
 * UnrecoverableError so cancels don't burn retries), and metrics.
 */
export function createStageWorker<T>(options: StageWorkerOptions<T>): Worker {
  const prefix = options.prefix ?? 'surfgen';
  const kv: CancellationKV =
    options.kv ??
    ({
      set: async (key, value, ttl) => {
        await (options.connection as RedisLike).set(key, value, 'EX', ttl);
      },
      get: async (key) => (options.connection as RedisLike).get(key),
    } satisfies CancellationKV);

  const processor = async (job: Job): Promise<unknown> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const checkCancelled = async () =>
      (await kv.get(cancellationKey(prefix, job.id as string))) === '1';

    const poller = setInterval(() => {
      void checkCancelled().then((cancelled) => {
        if (cancelled) controller.abort();
      });
    }, CANCELLATION_POLL_MS);
    poller.unref();

    const context: StageJobContext<T> = {
      id: job.id as string,
      name: job.name,
      data: job.data as T,
      attempt: job.attemptsMade + 1,
      updateProgress: async (percent, message, checkpoint) => {
        await job.updateProgress({
          percent: clampPercent(percent),
          ...(message !== undefined && { message }),
          ...(checkpoint !== undefined && { checkpoint }),
        });
      },
      isCancellationRequested: checkCancelled,
      signal: controller.signal,
    };

    try {
      if (await checkCancelled()) {
        throw new UnrecoverableError('cancelled');
      }
      const result = await options.handler(context);
      options.metrics?.jobsProcessed().inc({ stage: job.name, status: 'completed' });
      return result;
    } catch (error) {
      if (controller.signal.aborted || (error as Error).message === 'cancelled') {
        options.metrics?.jobsProcessed().inc({ stage: job.name, status: 'cancelled' });
        throw new UnrecoverableError('cancelled');
      }
      options.metrics?.jobsProcessed().inc({ stage: job.name, status: 'failed' });
      options.logger.error(
        { jobId: job.id, stage: job.name, attempt: job.attemptsMade + 1, error: String(error) },
        'stage job failed',
      );
      throw error;
    } finally {
      clearInterval(poller);
      options.metrics?.jobDuration().observe({ stage: job.name }, (Date.now() - startedAt) / 1000);
    }
  };

  return new Worker(queueNameToBullName(options.queue), processor, {
    connection: options.connection,
    concurrency: options.concurrency ?? QUEUE_DEFINITIONS[options.queue].concurrencyDefault,
  });
}
