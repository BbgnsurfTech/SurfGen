import { describe, expect, test } from 'vitest';
import { Writable } from 'node:stream';
import { InMemoryEventBus, createEnvelope } from '@surfgen/events';
import { createLogger } from '@surfgen/telemetry';
import type { EnqueueOptions, JobQueueName } from '@surfgen/core';
import { PipelineOrchestrator } from '../src/orchestrator.js';

const silentLogger = createLogger({
  service: 'test',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});

/** Minimal in-memory stand-in for the Prisma surface the orchestrator touches. */
function makeFakeDb() {
  const videos = new Map<string, Record<string, unknown>>();
  const runs = new Map<string, Record<string, unknown>>();
  const jobs: Record<string, unknown>[] = [];

  const db = {
    video: {
      findUnique: async ({ where }: { where: { id: string } }) => videos.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        videos.set(where.id, { ...videos.get(where.id), ...data });
        return videos.get(where.id);
      },
    },
    pipelineRun: {
      findUnique: async ({ where }: { where: { id: string } }) => runs.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const run = runs.get(where.id);
        if (!run) throw new Error('not found');
        return run;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        runs.set(where.id, { ...runs.get(where.id), ...data });
        return runs.get(where.id);
      },
    },
    job: {
      findMany: async ({ where }: { where: { pipelineRunId: string } }) =>
        jobs.filter((job) => job.pipelineRunId === where.pipelineRunId),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        jobs.push({ status: 'queued', ...data });
        return data;
      },
      updateMany: async () => ({ count: 0 }),
    },
    $transaction: async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return (ops as (tx: unknown) => Promise<unknown>)(db);
    },
  };
  return { db, videos, runs, jobs };
}

function makeFakeQueue() {
  const enqueued: { queue: JobQueueName; name: string; data: unknown; options?: EnqueueOptions }[] =
    [];
  return {
    enqueued,
    port: {
      enqueue: async (queue: JobQueueName, name: string, data: unknown, options?: EnqueueOptions) => {
        enqueued.push({ queue, name, data, options });
        return options?.jobId ?? 'id';
      },
      cancel: async () => true,
      getJob: async () => null,
    },
  };
}

async function setup(videoPipeline: Record<string, unknown> = { script: 'Hello world' }) {
  const { db, videos, runs, jobs } = makeFakeDb();
  const bus = new InMemoryEventBus();
  const { enqueued, port } = makeFakeQueue();

  videos.set('vid1', {
    id: 'vid1',
    title: 'Demo',
    status: 'queued',
    language: 'en',
    pipeline: videoPipeline,
    settings: {
      resolution: { width: 640, height: 360 },
      frameRate: 30,
      container: 'mp4',
      codec: 'h264',
      quality: 23,
    },
  });
  runs.set('run1', {
    id: 'run1',
    videoId: 'vid1',
    organizationId: 'org1',
    status: 'pending',
    definition: {},
    artifacts: {},
  });

  const orchestrator = new PipelineOrchestrator({
    prisma: db as never,
    queue: port,
    events: bus,
    subscriber: bus,
    logger: silentLogger,
  });
  await orchestrator.start();
  return { orchestrator, bus, enqueued, runs, videos, jobs };
}

const queuedEvent = () =>
  createEnvelope({
    name: 'video.queued',
    organizationId: 'org1',
    payload: { videoId: 'vid1', runId: 'run1' },
  });

const stageCompleted = (stage: string) =>
  createEnvelope({
    name: 'pipeline.stage_completed',
    organizationId: 'org1',
    payload: { runId: 'run1', stage },
  });

describe('PipelineOrchestrator', () => {
  test('video.queued starts the run and enqueues only the entry stage', async () => {
    const { bus, enqueued, runs, videos } = await setup();
    await bus.publish(queuedEvent());

    expect(runs.get('run1')?.status).toBe('running');
    expect(videos.get('vid1')?.status).toBe('generating');
    expect(enqueued.map((e) => e.name)).toEqual(['script']);
    expect(enqueued[0]?.options?.jobId).toBe('run1:script');
  });

  test('DAG advance: completing stages unlocks dependents until run completes', async () => {
    const { bus, enqueued, runs } = await setup();
    await bus.publish(queuedEvent());

    // Simulate stage workers: persist artifact then announce completion.
    const complete = async (stage: string) => {
      const run = runs.get('run1')!;
      runs.set('run1', {
        ...run,
        artifacts: { ...(run.artifacts as object), [stage]: { done: true } },
      });
      await bus.publish(stageCompleted(stage));
    };

    await complete('script');
    expect(enqueued.map((e) => e.name)).toEqual(['script', 'tts']);

    await complete('tts');
    // avatar + subtitles both depend only on tts → both enqueued.
    expect(enqueued.map((e) => e.name).sort()).toEqual(['avatar', 'script', 'subtitles', 'tts'].sort());

    await complete('avatar');
    await complete('subtitles');
    expect(enqueued.map((e) => e.name)).toContain('render');

    await complete('render');
    expect(enqueued.map((e) => e.name)).toContain('thumbnail');

    await complete('thumbnail');
    expect(enqueued.map((e) => e.name)).toContain('finalize');

    await complete('finalize');
    expect(runs.get('run1')?.status).toBe('completed');
  });

  test('progress events carry weighted overall percent', async () => {
    const { bus, runs } = await setup();
    const progress: number[] = [];
    await bus.subscribe(['video.progress'], async (event) => {
      progress.push((event.payload as { overallPercent: number }).overallPercent);
    });
    await bus.publish(queuedEvent());

    const run = runs.get('run1')!;
    runs.set('run1', { ...run, artifacts: { script: { done: true } } });
    await bus.publish(stageCompleted('script'));

    expect(progress.length).toBe(1);
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress[0]).toBeLessThan(100);
  });

  test('required stage failure fails the run and the video', async () => {
    const { bus, runs, videos } = await setup();
    await bus.publish(queuedEvent());
    await bus.publish(
      createEnvelope({
        name: 'pipeline.stage_failed',
        organizationId: 'org1',
        payload: { runId: 'run1', stage: 'tts', error: 'no healthy provider' },
      }),
    );
    expect(runs.get('run1')?.status).toBe('failed');
    expect(videos.get('vid1')?.status).toBe('failed');
    expect(videos.get('vid1')?.errorMessage).toBe('no healthy provider');
  });

  test('optional stage failure records a skip and continues', async () => {
    const { bus, runs } = await setup();
    await bus.publish(queuedEvent());
    // subtitles is optional in the default pipeline
    await bus.publish(
      createEnvelope({
        name: 'pipeline.stage_failed',
        organizationId: 'org1',
        payload: { runId: 'run1', stage: 'subtitles', error: 'font missing' },
      }),
    );
    const artifacts = runs.get('run1')?.artifacts as Record<string, { skipped?: boolean }>;
    expect(artifacts.subtitles?.skipped).toBe(true);
    expect(runs.get('run1')?.status).toBe('running');
  });

  test('duplicate stage_completed events do not double-enqueue (idempotency)', async () => {
    const { bus, enqueued, runs } = await setup();
    await bus.publish(queuedEvent());
    const run = runs.get('run1')!;
    runs.set('run1', { ...run, artifacts: { script: { done: true } } });

    await bus.publish(stageCompleted('script'));
    await bus.publish(stageCompleted('script')); // redelivery

    expect(enqueued.filter((e) => e.name === 'tts')).toHaveLength(1);
  });
});
