import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { createLogger, initTracing } from '@surfgen/telemetry';
import { AppModule } from './app.module';

const logger = createLogger({ service: 'surfgen-api' });

async function bootstrap(): Promise<void> {
  const tracing = await initTracing({ serviceName: 'surfgen-api' });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 50 * 1024 * 1024 }),
    { logger: false },
  );

  await app.register(helmet, { contentSecurityPolicy: false }); // API responses are JSON; CSP is set by the web app
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 300),
    timeWindow: '1 minute',
  });

  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableVersioning({ type: VersioningType.URI, prefix: 'v' });
  app.enableCors({ origin: process.env.CORS_ORIGINS?.split(',') ?? true, credentials: true });
  app.enableShutdownHooks();

  const openApiConfig = new DocumentBuilder()
    .setTitle('SurfGen API')
    .setDescription('Provider-agnostic AI avatar video generation platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, openApiConfig), {
    jsonDocumentUrl: 'docs/openapi.json',
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'surfgen-api listening');

  const shutdown = async () => {
    await app.close();
    await tracing.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void bootstrap();
