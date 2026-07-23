import { describe, expect, test } from 'vitest';
import { QUEUE_DEFINITIONS, bullNameToQueueName, queueNameToBullName } from '../src/queues.js';
import { ProgressUpdateSchema, clampPercent } from '../src/progress.js';
import { BullJobQueue, cancellationKey, mapBullState, type CancellationKV } from '../src/bull-queue.js';
import type { JobQueueName } from '@surfgen/core';

describe('queue names', () => {
  test('round-trip for every defined queue', () => {
    for (const name of Object.keys(QUEUE_DEFINITIONS) as JobQueueName[]) {
      expect(bullNameToQueueName(queueNameToBullName(name))).toBe(name);
    }
  });

  test('unknown or unprefixed names map to null', () => {
    expect(bullNameToQueueName('surfgen-not.a.queue')).toBeNull();
    expect(bullNameToQueueName('cpu.default')).toBeNull();
  });

  // BullMQ reserves ':' as its Redis key separator and throws
  // "Queue name cannot contain :" when a queue name includes one. The prefix
  // must therefore use a ':'-free separator. This guards the regression that
  // crash-looped the worker in production.
  test('no bull queue name contains a colon', () => {
    for (const name of Object.keys(QUEUE_DEFINITIONS) as JobQueueName[]) {
      expect(queueNameToBullName(name)).not.toContain(':');
    }
  });
});

describe('progress', () => {
  test('schema bounds percent and message length', () => {
    expect(ProgressUpdateSchema.safeParse({ percent: 50 }).success).toBe(true);
    expect(ProgressUpdateSchema.safeParse({ percent: 101 }).success).toBe(false);
    expect(ProgressUpdateSchema.safeParse({ percent: -1 }).success).toBe(false);
  });

  test('clampPercent handles out-of-range and non-finite values', () => {
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(42.5)).toBe(42.5);
  });
});

describe('mapBullState', () => {
  test.each([
    ['waiting', {}, 'queued'],
    ['waiting', { attemptsMade: 2 }, 'retrying'],
    ['delayed', {}, 'queued'],
    ['prioritized', {}, 'queued'],
    ['active', {}, 'active'],
    ['active', { progress: { percent: 40 } }, 'progress'],
    ['active', { progress: 0 }, 'active'],
    ['active', { progress: 10 }, 'progress'],
    ['completed', {}, 'completed'],
    ['failed', {}, 'failed'],
    ['unknown-state', {}, 'queued'],
  ] as const)('%s + %o → %s', (state, job, expected) => {
    expect(mapBullState(state, job)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// BullJobQueue with stub queue factory + KV
// ---------------------------------------------------------------------------
type StubJob = {
  id: string;
  state: string;
  removed?: boolean;
  getState: () => Promise<string>;
  remove: () => Promise<void>;
};

function makeStubs(jobs: Record<string, StubJob> = {}) {
  const added: { bullName: string; name: string; data: unknown; opts: Record<string, unknown> }[] =
    [];
  const kvStore = new Map<string, string>();
  const kv: CancellationKV = {
    set: async (key, value) => {
      kvStore.set(key, value);
    },
    get: async (key) => kvStore.get(key) ?? null,
  };
  const queue = new BullJobQueue({
    connection: { host: 'localhost', port: 6379 },
    kv,
    queueFactory: (bullName) =>
      ({
        add: async (name: string, data: unknown, opts: Record<string, unknown>) => {
          added.push({ bullName, name, data, opts });
          return { id: (opts.jobId as string) ?? 'generated-id' };
        },
        getJob: async (jobId: string) => jobs[jobId],
        close: async () => {},
      }) as never,
  });
  return { queue, added, kvStore };
}

const stubJob = (id: string, state: string): StubJob => {
  const job: StubJob = {
    id,
    state,
    getState: async () => job.state,
    remove: async () => {
      job.removed = true;
    },
  };
  return job;
};

describe('BullJobQueue', () => {
  test('enqueue maps options to BullMQ semantics', async () => {
    const { queue, added } = makeStubs();
    const jobId = await queue.enqueue('gpu.default', 'tts', { text: 'hi' }, {
      priority: 'high',
      delayMs: 250,
      jobId: 'job-1',
      maxAttempts: 5,
    });
    expect(jobId).toBe('job-1');
    expect(added[0]).toMatchObject({
      bullName: 'surfgen-gpu.default',
      name: 'tts',
      data: { text: 'hi' },
      opts: {
        priority: 2, // JOB_PRIORITY_WEIGHT.high
        delay: 250,
        jobId: 'job-1',
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });
  });

  test('cancel removes waiting jobs', async () => {
    const waiting = stubJob('j1', 'waiting');
    const { queue } = makeStubs({ j1: waiting });
    expect(await queue.cancel('cpu.default', 'j1')).toBe(true);
    expect(waiting.removed).toBe(true);
  });

  test('cancel sets cooperative flag for active jobs', async () => {
    const active = stubJob('j2', 'active');
    const { queue, kvStore } = makeStubs({ j2: active });
    expect(await queue.cancel('cpu.default', 'j2')).toBe(true);
    expect(active.removed).toBeUndefined();
    expect(kvStore.get(cancellationKey('surfgen', 'j2'))).toBe('1');
    expect(await queue.isCancellationRequested('j2')).toBe(true);
    expect(await queue.isCancellationRequested('other')).toBe(false);
  });

  test('cancel returns false for missing or terminal jobs', async () => {
    const done = stubJob('j3', 'completed');
    const { queue } = makeStubs({ j3: done });
    expect(await queue.cancel('cpu.default', 'j3')).toBe(false);
    expect(await queue.cancel('cpu.default', 'missing')).toBe(false);
  });
});
