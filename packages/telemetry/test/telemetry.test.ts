import { describe, expect, test } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../src/logger.js';
import { MetricsRegistry } from '../src/metrics.js';
import { initTracing, withSpan } from '../src/tracing.js';

function captureStream(lines: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
}

describe('logger', () => {
  test('emits structured JSON with service binding', () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'api', destination: captureStream(lines) });
    logger.info({ videoId: 'vid_1' }, 'video created');
    const entry = JSON.parse(lines[0]!);
    expect(entry.service).toBe('api');
    expect(entry.videoId).toBe('vid_1');
    expect(entry.msg).toBe('video created');
    expect(entry.level).toBe('info');
  });

  test('redacts secrets at any depth', () => {
    const lines: string[] = [];
    const logger = createLogger({ service: 'api', destination: captureStream(lines) });
    logger.info(
      { provider: { apiKey: 'sk-super-secret' }, token: 'jwt-value', safe: 'visible' },
      'provider call',
    );
    const raw = lines[0]!;
    expect(raw).not.toContain('sk-super-secret');
    expect(raw).not.toContain('jwt-value');
    expect(raw).toContain('[REDACTED]');
    expect(raw).toContain('visible');
  });
});

describe('metrics', () => {
  test('metric creation is idempotent by name', () => {
    const metrics = new MetricsRegistry({ service: 'worker' });
    const a = metrics.counter('surfgen_test_total', 'test', ['label']);
    const b = metrics.counter('surfgen_test_total', 'test', ['label']);
    expect(a).toBe(b);
  });

  test('platform metrics render in exposition format', async () => {
    const metrics = new MetricsRegistry({ service: 'worker' });
    metrics.jobsProcessed().inc({ stage: 'tts', status: 'completed' });
    metrics.jobDuration().observe({ stage: 'tts' }, 1.5);
    metrics.providerFailures().inc({ provider: 'tts-piper', capability: 'tts' });
    const text = await metrics.metricsText();
    expect(text).toContain('surfgen_jobs_processed_total{stage="tts",status="completed",service="worker"} 1');
    expect(text).toContain('surfgen_job_duration_seconds_bucket');
    expect(text).toContain('surfgen_provider_failures_total');
  });
});

describe('tracing', () => {
  test('disabled tracing returns a working no-op handle', async () => {
    const handle = await initTracing({ serviceName: 'test', enabled: false });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  test('withSpan returns the value and rethrows errors', async () => {
    expect(await withSpan('ok-span', async () => 41 + 1)).toBe(42);
    await expect(
      withSpan('err-span', async () => {
        throw new Error('span boom');
      }),
    ).rejects.toThrow('span boom');
  });
});
