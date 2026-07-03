import type { EventEnvelope } from '../events/domain-events.js';
import type { JobDescriptor, JobPriority, JobQueueName } from '../domain/job.js';

/**
 * Ports (hexagonal architecture): interfaces the domain/application layer
 * depends on; infrastructure packages provide the adapters.
 */

export interface ClockPort {
  now(): Date;
}

export interface EventPublisherPort {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  publishMany(events: readonly EventEnvelope[]): Promise<void>;
}

export interface EventSubscriberPort {
  /**
   * Subscribe to routing patterns (AMQP topic syntax, e.g. "video.*").
   * Handler resolution acks; a thrown error nacks for redelivery/DLQ.
   */
  subscribe(
    patterns: readonly string[],
    handler: (event: EventEnvelope) => Promise<void>,
    options?: { queueName?: string; prefetch?: number },
  ): Promise<{ unsubscribe: () => Promise<void> }>;
}

export interface EnqueueOptions {
  readonly priority?: JobPriority;
  readonly delayMs?: number;
  readonly jobId?: string; // idempotency: same id = deduplicated
  readonly maxAttempts?: number;
}

export interface JobQueuePort {
  enqueue<T>(queue: JobQueueName, name: string, data: T, options?: EnqueueOptions): Promise<string>;
  cancel(queue: JobQueueName, jobId: string): Promise<boolean>;
  getJob(queue: JobQueueName, jobId: string): Promise<JobDescriptor | null>;
}

export interface PutObjectOptions {
  readonly contentType?: string;
  readonly metadata?: Record<string, string>;
  readonly cacheControl?: string;
}

export interface StorageObjectStat {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType?: string;
  readonly lastModified?: Date;
  readonly metadata?: Record<string, string>;
}

export interface StoragePort {
  put(
    key: string,
    body: Uint8Array | NodeJS.ReadableStream,
    options?: PutObjectOptions,
  ): Promise<StorageObjectStat>;
  get(key: string): Promise<NodeJS.ReadableStream>;
  stat(key: string): Promise<StorageObjectStat | null>;
  delete(key: string): Promise<void>;
  list(prefix: string, options?: { maxKeys?: number; cursor?: string }): Promise<{
    objects: StorageObjectStat[];
    cursor?: string;
  }>;
  /** Time-limited signed URL for direct client access (download or upload). */
  signedUrl(
    key: string,
    options: { method: 'GET' | 'PUT'; expiresInSeconds: number; contentType?: string },
  ): Promise<string>;
}

export interface UnitOfWorkPort {
  /** Run `fn` inside a transaction; outbox events written in the same tx. */
  execute<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}
