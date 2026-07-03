import type { ProviderRegistry } from '@surfgen/ai-sdk';
import type { EventPublisherPort, StoragePort } from '@surfgen/core';
import type { PrismaClient } from '@surfgen/db';
import type { Logger, MetricsRegistry } from '@surfgen/telemetry';
import type { VideoConfig } from '@surfgen/config';

/** Everything a stage handler may touch — one injection point, easy to fake in tests. */
export interface StageRuntime {
  readonly prisma: PrismaClient;
  readonly storage: StoragePort;
  readonly registry: ProviderRegistry;
  readonly events: EventPublisherPort;
  readonly logger: Logger;
  readonly metrics: MetricsRegistry;
  readonly videoConfig: VideoConfig;
  /** Working directory for intermediate media files. */
  readonly workDir: string;
}

export interface StageJobData {
  readonly runId: string;
  readonly videoId: string;
  readonly organizationId: string;
  readonly stage: string;
}

/** Persisted per-stage outputs, keyed by stage name in PipelineRun.artifacts. */
export type ArtifactMap = Record<string, Record<string, unknown>>;

export async function loadArtifacts(
  prisma: PrismaClient,
  runId: string,
): Promise<ArtifactMap> {
  const run = await prisma.pipelineRun.findUnique({ where: { id: runId } });
  return (run?.artifacts as ArtifactMap | null) ?? {};
}

/**
 * Persist a stage's artifacts atomically. Uses a read-modify-write inside a
 * transaction; stages never run concurrently for the same key thanks to the
 * DAG, but two different stages can complete simultaneously.
 */
export async function saveArtifact(
  prisma: PrismaClient,
  runId: string,
  stage: string,
  artifact: Record<string, unknown>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const run = await tx.pipelineRun.findUniqueOrThrow({ where: { id: runId } });
    const artifacts = { ...((run.artifacts as ArtifactMap | null) ?? {}), [stage]: artifact };
    await tx.pipelineRun.update({
      where: { id: runId },
      data: { artifacts: artifacts as never },
    });
  });
}
