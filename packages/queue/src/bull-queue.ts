import { Queue, type ConnectionOptions, type JobsOptions, type Job as BullJob } from 'bullmq';
import {
  JOB_PRIORITY_WEIGHT,
  type EnqueueOptions,
  type JobDescriptor,
  type JobQueuePort,
  type JobQueueName,
  type JobStatus,
} from '@surfgen/core';
import { queueNameToBullName } from './queues.js';

/** Minimal KV surface used for cancellation flags — injectable for tests. */
export interface CancellationKV {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
}

export const cancellationKey = (prefix: string, jobId: string): string =>
  `${prefix}:cancel:${jobId}`;

export interface BullJobQueueOptions {
  readonly connection: ConnectionOptions;
  readonly prefix?: string;
  /** Test hooks. */
  readonly queueFactory?: (bullName: string) => Pick<Queue, 'add' | 'getJob' | 'close'>;
  readonly kv?: CancellationKV;
}

const CANCEL_FLAG_TTL_SECONDS = 3600;
const RETRY_BACKOFF_MS = 5_000;
const KEEP_COMPLETED = { age: 86_400, count: 10_000 };
const KEEP_FAILED = { age: 604_800 };

/** Map a BullMQ job state to the domain JobStatus. */
export function mapBullState(
  state: string,
  job?: { progress?: unknown; attemptsMade?: number },
): JobStatus {
  switch (state) {
    case 'waiting':
    case 'waiting-children':
    case 'delayed':
    case 'prioritized':
      return (job?.attemptsMade ?? 0) > 0 ? 'retrying' : 'queued';
    case 'active': {
      const progress = job?.progress;
      const hasProgress =
        typeof progress === 'number'
          ? progress > 0
          : typeof progress === 'object' && progress !== null;
      return hasProgress ? 'progress' : 'active';
    }
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'queued';
  }
}

/** BullMQ adapter for the JobQueuePort. */
export class BullJobQueue implements JobQueuePort {
  private readonly queues = new Map<string, Pick<Queue, 'add' | 'getJob' | 'close'>>();
  private readonly prefix: string;
  private readonly kv: CancellationKV;

  constructor(private readonly options: BullJobQueueOptions) {
    this.prefix = options.prefix ?? 'surfgen';
    this.kv =
      options.kv ??
      ({
        set: async (key, value, ttlSeconds) => {
          await (this.options.connection as RedisLike).set(key, value, 'EX', ttlSeconds);
        },
        get: async (key) => (this.options.connection as RedisLike).get(key),
      } satisfies CancellationKV);
  }

  private getQueue(name: JobQueueName): Pick<Queue, 'add' | 'getJob' | 'close'> {
    const bullName = queueNameToBullName(name);
    const existing = this.queues.get(bullName);
    if (existing) return existing;
    const queue = this.options.queueFactory
      ? this.options.queueFactory(bullName)
      : new Queue(bullName, { connection: this.options.connection });
    this.queues.set(bullName, queue);
    return queue;
  }

  async enqueue<T>(
    queueName: JobQueueName,
    name: string,
    data: T,
    options: EnqueueOptions = {},
  ): Promise<string> {
    const jobsOptions: JobsOptions = {
      priority: JOB_PRIORITY_WEIGHT[options.priority ?? 'normal'],
      attempts: options.maxAttempts ?? 3,
      backoff: { type: 'exponential', delay: RETRY_BACKOFF_MS },
      removeOnComplete: KEEP_COMPLETED,
      removeOnFail: KEEP_FAILED,
      ...(options.delayMs !== undefined && { delay: options.delayMs }),
      ...(options.jobId !== undefined && { jobId: options.jobId }),
    };
    const job = await this.getQueue(queueName).add(name, data, jobsOptions);
    return job.id as string;
  }

  /**
   * Cancellation: queued/delayed jobs are removed outright; active jobs get a
   * cooperative cancellation flag that stage workers poll (StageJobContext).
   */
  async cancel(queueName: JobQueueName, jobId: string): Promise<boolean> {
    const job = await this.getQueue(queueName).getJob(jobId);
    if (!job) return false;
    const state = await job.getState();
    if (state === 'waiting' || state === 'delayed' || state === 'prioritized') {
      await job.remove();
      return true;
    }
    if (state === 'active') {
      await this.kv.set(cancellationKey(this.prefix, jobId), '1', CANCEL_FLAG_TTL_SECONDS);
      return true;
    }
    return false;
  }

  async isCancellationRequested(jobId: string): Promise<boolean> {
    return (await this.kv.get(cancellationKey(this.prefix, jobId))) === '1';
  }

  async getJob(queueName: JobQueueName, jobId: string): Promise<JobDescriptor | null> {
    const job = (await this.getQueue(queueName).getJob(jobId)) as BullJob | undefined;
    if (!job) return null;
    const state = await job.getState();
    const progress = job.progress;
    return {
      id: job.id as never,
      organizationId: (job.data?.organizationId ?? '') as never,
      pipelineRunId: (job.data?.runId ?? '') as never,
      stage: job.name,
      queue: queueName,
      status: mapBullState(state, job),
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      priority: 'normal',
      ...(typeof progress === 'object' && progress !== null
        ? { progress: progress as never }
        : {}),
      ...(job.failedReason
        ? { error: { code: 'PIPELINE_ERROR', message: job.failedReason, retryable: true } }
        : {}),
    };
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }
}

/** Structural view of an ioredis client used for cancellation flags. */
export interface RedisLike {
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
}
