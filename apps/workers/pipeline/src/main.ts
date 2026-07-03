import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ModelDiscoveryService, ProviderRegistry } from '@surfgen/ai-sdk';
import { loadAll, type ConfigBundle } from '@surfgen/config';
import { unwrap, type JobQueueName, type StoragePort } from '@surfgen/core';
import { createPrismaClient, withSoftDelete } from '@surfgen/db';
import { InMemoryEventBus, RabbitMqEventBus, createEnvelope } from '@surfgen/events';
import { PluginLoader } from '@surfgen/plugin-sdk';
import { BullJobQueue, createStageWorker, QUEUE_DEFINITIONS } from '@surfgen/queue';
import { LocalStorage, S3Storage } from '@surfgen/storage';
import { resolveSecretRef } from '@surfgen/plugin-sdk';
import { MetricsRegistry, createLogger, initTracing } from '@surfgen/telemetry';
import type { Worker } from 'bullmq';
import { PipelineOrchestrator } from './orchestrator.js';
import { createStageHandlers } from './stages/handlers.js';
import type { StageJobData, StageRuntime } from './runtime.js';

const logger = createLogger({ service: 'surfgen-worker' });

function buildStorage(bundle: ConfigBundle): StoragePort {
  if (bundle.storage.driver === 's3' && bundle.storage.s3) {
    const s3 = bundle.storage.s3;
    return new S3Storage({
      bucket: s3.bucket,
      region: s3.region,
      ...(s3.endpoint && { endpoint: s3.endpoint }),
      accessKeyId: resolveSecretRef(s3.accessKeyRef),
      secretAccessKey: resolveSecretRef(s3.secretKeyRef),
      forcePathStyle: s3.forcePathStyle,
    });
  }
  return new LocalStorage(bundle.storage.local?.rootDir ?? './storage/local');
}

async function main(): Promise<void> {
  const tracing = await initTracing({ serviceName: 'surfgen-worker' });
  const configDir = process.env.SURFGEN_CONFIG_DIR ?? resolve(process.cwd(), 'config');
  const bundle = unwrap(loadAll(configDir));

  const prisma = withSoftDelete(createPrismaClient());
  const storage = buildStorage(bundle);
  const metrics = new MetricsRegistry({ service: 'surfgen-worker', defaultMetrics: true });

  // Event bus: RabbitMQ in real deployments, in-memory for single-process dev.
  const amqpUrl = process.env.AMQP_URL;
  const bus = amqpUrl ? new RabbitMqEventBus({ url: amqpUrl, logger }) : new InMemoryEventBus();
  if (bus instanceof RabbitMqEventBus) await bus.connect();
  else logger.warn('AMQP_URL not set — in-memory bus (orchestrator+workers must share process)');

  // Provider registry: plugins + auto-discovery.
  const registry = new ProviderRegistry({
    onHealthChange: (providerId, capability, healthy) => {
      void bus.publish(
        createEnvelope({
          name: 'provider.health_changed',
          payload: { providerId, capability, healthy },
        }),
      );
    },
  });

  const pluginsDir = process.env.SURFGEN_PLUGINS_DIR ?? resolve(process.cwd(), 'plugins');
  const loader = new PluginLoader();
  const { loaded, failures } = await loader.loadAll(pluginsDir);
  const providerOptions = new Map(
    bundle.providers.providers.map((provider) => [provider.id, provider]),
  );
  for (const plugin of loaded) {
    try {
      // Pass through per-provider options (matched by plugin name = provider id
      // convention, falling back to empty options) plus shared services.
      const options = providerOptions.get(plugin.manifest.name)?.options ?? {};
      await plugin.register(registry, { ...options, storage });
      logger.info({ plugin: plugin.manifest.name }, 'plugin registered');
    } catch (error) {
      logger.warn({ plugin: plugin.manifest.name, error: String(error) }, 'plugin skipped');
    }
  }
  for (const failure of failures) {
    logger.warn({ dir: failure.dir, error: failure.error.message }, 'plugin failed to load');
  }

  const discovered = await new ModelDiscoveryService().discover();
  logger.info({ runtimes: discovered.map((r) => r.id) }, 'local runtimes discovered');

  const runtime: StageRuntime = {
    prisma,
    storage,
    registry,
    events: bus,
    logger,
    metrics,
    videoConfig: bundle.video,
    workDir: join(tmpdir(), 'surfgen-work'),
  };

  // Queues + orchestrator.
  const connection = {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
  };
  const queue = new BullJobQueue({ connection });
  const orchestrator = new PipelineOrchestrator({
    prisma,
    queue,
    events: bus,
    subscriber: bus,
    logger,
  });
  await orchestrator.start();

  // Stage workers — WORKER_QUEUES selects the resource classes this pod serves.
  const queueNames = (process.env.WORKER_QUEUES ?? 'cpu.default,cpu.media,gpu.default,gpu.heavy')
    .split(',')
    .map((name) => name.trim())
    .filter((name): name is JobQueueName => name in QUEUE_DEFINITIONS);

  const handlers = createStageHandlers(runtime);
  const workers: Worker[] = queueNames.map((queueName) =>
    createStageWorker<StageJobData>({
      queue: queueName,
      connection,
      logger,
      metrics,
      handler: async (ctx) => {
        const handler = handlers[ctx.data.stage];
        if (!handler) throw new Error(`No handler for stage '${ctx.data.stage}'`);
        await handler(ctx);
      },
    }),
  );
  logger.info({ queues: queueNames }, 'surfgen-worker started');

  const shutdown = async () => {
    logger.info('shutting down');
    await Promise.allSettled(workers.map((worker) => worker.close()));
    await orchestrator.stop();
    await queue.close();
    if (bus instanceof RabbitMqEventBus) await bus.close();
    await prisma.$disconnect();
    await tracing.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((error) => {
  logger.error({ error: String(error) }, 'worker crashed on startup');
  process.exit(1);
});
