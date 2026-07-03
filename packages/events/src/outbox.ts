import type { EventEnvelope, EventPublisherPort } from '@surfgen/core';
import type { Logger } from '@surfgen/telemetry';

/**
 * Transactional outbox: domain writes and their events are persisted in the
 * same database transaction; the relay publishes them asynchronously, giving
 * at-least-once delivery without dual-write races.
 */
export interface OutboxRecord {
  readonly id: string;
  readonly envelope: EventEnvelope;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
  readonly attempts: number;
}

export interface OutboxStore {
  /** Persist records (called inside the domain transaction). */
  save(records: readonly OutboxRecord[], tx?: unknown): Promise<void>;
  /** Unpublished records with attempts < maxAttempts, oldest first. */
  fetchUnpublished(limit: number, maxAttempts: number): Promise<OutboxRecord[]>;
  markPublished(ids: readonly string[]): Promise<void>;
  incrementAttempts(ids: readonly string[]): Promise<void>;
}

export interface OutboxRelayOptions {
  readonly store: OutboxStore;
  readonly publisher: EventPublisherPort;
  readonly logger: Logger;
  readonly batchSize?: number;
  readonly intervalMs?: number;
  readonly maxAttempts?: number;
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: OutboxRelayOptions) {
    this.batchSize = options.batchSize ?? 100;
    this.intervalMs = options.intervalMs ?? 1_000;
    this.maxAttempts = options.maxAttempts ?? 10;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Let an in-flight tick finish.
    while (this.ticking) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }

  /** One relay pass — exposed for tests and manual draining. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const batch = await this.options.store.fetchUnpublished(this.batchSize, this.maxAttempts);
      if (batch.length === 0) return;
      const ids = batch.map((record) => record.id);
      try {
        await this.options.publisher.publishMany(batch.map((record) => record.envelope));
        await this.options.store.markPublished(ids);
      } catch (error) {
        this.options.logger.warn(
          { count: ids.length, error: String(error) },
          'outbox publish failed — will retry',
        );
        await this.options.store.incrementAttempts(ids);
      }
    } finally {
      this.ticking = false;
    }
  }
}

/** Reference store used by tests and single-node dev. */
export class InMemoryOutboxStore implements OutboxStore {
  private readonly records = new Map<string, OutboxRecord>();

  async save(records: readonly OutboxRecord[]): Promise<void> {
    for (const record of records) this.records.set(record.id, record);
  }

  async fetchUnpublished(limit: number, maxAttempts: number): Promise<OutboxRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.publishedAt === null && record.attempts < maxAttempts)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }

  async markPublished(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const record = this.records.get(id);
      if (record) this.records.set(id, { ...record, publishedAt: new Date() });
    }
  }

  async incrementAttempts(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const record = this.records.get(id);
      if (record) this.records.set(id, { ...record, attempts: record.attempts + 1 });
    }
  }

  get(id: string): OutboxRecord | undefined {
    return this.records.get(id);
  }
}
