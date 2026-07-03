import type { PrismaClient, Prisma } from '@prisma/client';
import type { EventEnvelope } from '@surfgen/core';

/**
 * Prisma-backed OutboxStore (see @surfgen/events). Records are written inside
 * the caller's transaction via the optional `tx` parameter.
 */
export interface PrismaOutboxRecord {
  readonly id: string;
  readonly envelope: EventEnvelope;
  readonly createdAt: Date;
  readonly publishedAt: Date | null;
  readonly attempts: number;
}

export class PrismaOutboxStore {
  constructor(private readonly client: PrismaClient) {}

  async save(records: readonly PrismaOutboxRecord[], tx?: unknown): Promise<void> {
    const db = (tx as PrismaClient | undefined) ?? this.client;
    await db.outboxEvent.createMany({
      data: records.map((record) => ({
        id: record.id,
        envelope: record.envelope as unknown as Prisma.InputJsonValue,
        attempts: record.attempts,
        publishedAt: record.publishedAt,
        createdAt: record.createdAt,
      })),
      skipDuplicates: true,
    });
  }

  async fetchUnpublished(limit: number, maxAttempts: number): Promise<PrismaOutboxRecord[]> {
    const rows = await this.client.outboxEvent.findMany({
      where: { publishedAt: null, attempts: { lt: maxAttempts } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => ({
      id: row.id,
      envelope: row.envelope as unknown as EventEnvelope,
      createdAt: row.createdAt,
      publishedAt: row.publishedAt,
      attempts: row.attempts,
    }));
  }

  async markPublished(ids: readonly string[]): Promise<void> {
    await this.client.outboxEvent.updateMany({
      where: { id: { in: [...ids] } },
      data: { publishedAt: new Date() },
    });
  }

  async incrementAttempts(ids: readonly string[]): Promise<void> {
    await this.client.outboxEvent.updateMany({
      where: { id: { in: [...ids] } },
      data: { attempts: { increment: 1 } },
    });
  }
}
