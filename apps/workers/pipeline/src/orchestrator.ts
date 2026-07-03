import {
  readyStages,
  validatePipeline,
  type EventPublisherPort,
  type EventSubscriberPort,
  type JobQueuePort,
  type PipelineDefinition,
} from '@surfgen/core';
import { createEnvelope } from '@surfgen/events';
import type { PrismaClient } from '@surfgen/db';
import type { Logger } from '@surfgen/telemetry';
import { defaultVideoPipeline, STAGE_PROGRESS_WEIGHTS } from './pipelines/default-video.js';
import type { ArtifactMap } from './runtime.js';

export interface OrchestratorDeps {
  readonly prisma: PrismaClient;
  readonly queue: JobQueuePort;
  readonly events: EventPublisherPort;
  readonly subscriber: EventSubscriberPort;
  readonly logger: Logger;
}

interface RunRow {
  id: string;
  videoId: string;
  organizationId: string;
  definition: unknown;
  artifacts: unknown;
  status: string;
}

/**
 * Event-driven pipeline orchestrator. Reacts to:
 *   video.queued              → start run, enqueue entry stages
 *   pipeline.stage_completed  → advance DAG, enqueue newly-ready stages
 *   pipeline.stage_failed     → skip (optional stage) or fail the run
 *   video.cancelled           → cancel outstanding jobs
 *
 * All state lives in PipelineRun rows; the orchestrator is stateless and can
 * run replicated (jobId dedup via `runId:stage` makes double-enqueues no-ops).
 */
export class PipelineOrchestrator {
  private subscriptions: { unsubscribe: () => Promise<void> }[] = [];

  constructor(private readonly deps: OrchestratorDeps) {}

  async start(): Promise<void> {
    const { subscriber } = this.deps;
    this.subscriptions = await Promise.all([
      subscriber.subscribe(['video.queued'], (e) => this.onVideoQueued(e.payload as never), {
        queueName: 'orchestrator.video-queued',
      }),
      subscriber.subscribe(
        ['pipeline.stage_completed'],
        (e) => this.onStageCompleted(e.payload as never),
        { queueName: 'orchestrator.stage-completed' },
      ),
      subscriber.subscribe(
        ['pipeline.stage_failed'],
        (e) => this.onStageFailed(e.payload as never),
        { queueName: 'orchestrator.stage-failed' },
      ),
    ]);
  }

  async stop(): Promise<void> {
    await Promise.all(this.subscriptions.map((s) => s.unsubscribe()));
  }

  private async onVideoQueued(payload: { videoId: string; runId: string }): Promise<void> {
    const { prisma, logger } = this.deps;
    const video = await prisma.video.findUnique({ where: { id: payload.videoId } });
    const run = await prisma.pipelineRun.findUnique({ where: { id: payload.runId } });
    if (!video || !run || run.status !== 'pending') return;

    const pipelineInput = (video.pipeline ?? {}) as { script?: string; targetLanguage?: string };
    const definition = defaultVideoPipeline({
      translate: Boolean(pipelineInput.targetLanguage),
      generateScript: !pipelineInput.script,
    });
    const validation = validatePipeline(definition);
    if (!validation.valid) {
      logger.error({ runId: run.id, errors: validation.errors }, 'invalid pipeline definition');
      await this.failRun(run as RunRow, `Invalid pipeline: ${validation.errors.join('; ')}`);
      return;
    }

    await prisma.$transaction([
      prisma.pipelineRun.update({
        where: { id: run.id },
        data: { status: 'running', startedAt: new Date(), definition: definition as never },
      }),
      prisma.video.update({ where: { id: video.id }, data: { status: 'generating' } }),
    ]);

    await this.deps.events.publish(
      createEnvelope({
        name: 'pipeline.run_started',
        organizationId: run.organizationId,
        correlationId: run.id,
        payload: { runId: run.id, videoId: video.id },
      }),
    );

    await this.enqueueReady({ ...(run as RunRow), definition }, definition, {});
  }

  private async onStageCompleted(payload: {
    runId: string;
    stage: string;
  }): Promise<void> {
    const { prisma } = this.deps;
    const run = (await prisma.pipelineRun.findUnique({ where: { id: payload.runId } })) as RunRow | null;
    if (!run || run.status !== 'running') return;

    const definition = run.definition as PipelineDefinition;
    const artifacts = (run.artifacts as ArtifactMap | null) ?? {};
    const completed = new Set(Object.keys(artifacts));

    await this.publishProgress(run, completed);

    if (definition.stages.every((stage) => completed.has(stage.name))) {
      await this.completeRun(run);
      return;
    }
    await this.enqueueReady(run, definition, artifacts);
  }

  private async onStageFailed(payload: {
    runId: string;
    stage: string;
    error: string;
    optional?: boolean;
  }): Promise<void> {
    const { prisma, logger } = this.deps;
    const run = (await prisma.pipelineRun.findUnique({ where: { id: payload.runId } })) as RunRow | null;
    if (!run || run.status !== 'running') return;

    const definition = run.definition as PipelineDefinition;
    const stage = definition.stages.find((s) => s.name === payload.stage);

    if (stage?.optional) {
      // Optional failure: record an empty artifact so dependents unblock.
      logger.warn({ runId: run.id, stage: payload.stage }, 'optional stage failed — skipping');
      const artifacts = (run.artifacts as ArtifactMap | null) ?? {};
      artifacts[payload.stage] = { skipped: true, error: payload.error };
      await prisma.pipelineRun.update({
        where: { id: run.id },
        data: { artifacts: artifacts as never },
      });
      await this.onStageCompleted({ runId: run.id, stage: payload.stage });
      return;
    }

    await this.failRun(run, payload.error);
  }

  private async enqueueReady(
    run: RunRow,
    definition: PipelineDefinition,
    artifacts: ArtifactMap,
  ): Promise<void> {
    const completed = new Set(Object.keys(artifacts));
    const startedJobs = await this.deps.prisma.job.findMany({
      where: { pipelineRunId: run.id },
      select: { stage: true },
    });
    const started = new Set(startedJobs.map((job) => job.stage));

    for (const stage of readyStages(definition, completed, started)) {
      const jobId = `${run.id}:${stage.name}`;
      await this.deps.prisma.job.create({
        data: {
          pipelineRunId: run.id,
          stage: stage.name,
          queue: stage.queue,
          maxAttempts: stage.maxAttempts,
          externalJobId: jobId,
        },
      });
      await this.deps.queue.enqueue(
        stage.queue,
        stage.name,
        {
          runId: run.id,
          videoId: run.videoId,
          organizationId: run.organizationId,
          stage: stage.name,
        },
        { jobId, maxAttempts: stage.maxAttempts },
      );
      await this.deps.events.publish(
        createEnvelope({
          name: 'pipeline.stage_started',
          organizationId: run.organizationId,
          correlationId: run.id,
          payload: { runId: run.id, stage: stage.name },
        }),
      );
    }
  }

  private async publishProgress(run: RunRow, completed: ReadonlySet<string>): Promise<void> {
    const definition = run.definition as PipelineDefinition;
    const totalWeight = definition.stages.reduce(
      (sum, stage) => sum + (STAGE_PROGRESS_WEIGHTS[stage.name] ?? 5),
      0,
    );
    const doneWeight = definition.stages
      .filter((stage) => completed.has(stage.name))
      .reduce((sum, stage) => sum + (STAGE_PROGRESS_WEIGHTS[stage.name] ?? 5), 0);

    await this.deps.events.publish(
      createEnvelope({
        name: 'video.progress',
        organizationId: run.organizationId,
        correlationId: run.id,
        payload: {
          videoId: run.videoId,
          runId: run.id,
          stage: [...completed].at(-1) ?? '',
          overallPercent: Math.round((doneWeight / totalWeight) * 100),
          stagePercent: 100,
        },
      }),
    );
  }

  private async completeRun(run: RunRow): Promise<void> {
    await this.deps.prisma.pipelineRun.update({
      where: { id: run.id },
      data: { status: 'completed', finishedAt: new Date() },
    });
    await this.deps.events.publish(
      createEnvelope({
        name: 'pipeline.run_completed',
        organizationId: run.organizationId,
        correlationId: run.id,
        payload: { runId: run.id, videoId: run.videoId },
      }),
    );
  }

  private async failRun(run: RunRow, error: string): Promise<void> {
    await this.deps.prisma.$transaction([
      this.deps.prisma.pipelineRun.update({
        where: { id: run.id },
        data: { status: 'failed', error, finishedAt: new Date() },
      }),
      this.deps.prisma.video.update({
        where: { id: run.videoId },
        data: { status: 'failed', errorMessage: error },
      }),
    ]);
    await this.deps.events.publish(
      createEnvelope({
        name: 'video.failed',
        organizationId: run.organizationId,
        correlationId: run.id,
        payload: { videoId: run.videoId, runId: run.id, error },
      }),
    );
  }
}
