import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { InMemoryEventBus, RabbitMqEventBus } from '@surfgen/events';
import { MetricsRegistry, createLogger } from '@surfgen/telemetry';
import { AuthModule } from './auth/auth.module';
import { BillingAdminController } from './billing/billing-admin.controller';
import { BillingController } from './billing/billing.controller';
import { BillingWebhookController } from './billing/billing-webhook.controller';
import { BillingService } from './billing/billing.service';
import { AuditInterceptor } from './common/audit.interceptor';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { EnvelopeInterceptor } from './common/envelope.interceptor';
import { PrismaService } from './common/prisma.service';
import { storageProvider } from './common/storage.provider';
import { HealthController } from './health/health.controller';
import { AdminController } from './workspace/admin.controller';
import { BrandExtractController } from './workspace/brand-extract.controller';
import { BrandsWorkflowsController } from './workspace/brands-workflows.controller';
import { DeveloperController } from './workspace/developer.controller';
import { LibraryController } from './workspace/library.controller';
import { StatsController } from './workspace/stats.controller';
import { OrgsController } from './orgs/orgs.controller';
import { ProjectsController } from './projects/projects.controller';
import { EditorController } from './videos/editor.controller';
import { VideosController } from './videos/videos.controller';
import { EVENT_BUS, VideosService } from './videos/videos.service';
import { EVENT_SUBSCRIBER, ProgressGateway } from './ws/progress.gateway';

const logger = createLogger({ service: 'surfgen-api' });

/**
 * Event bus provider: RabbitMQ when AMQP_URL is configured, otherwise the
 * in-process bus (single-node dev without docker).
 */
const eventBusProvider = {
  provide: EVENT_BUS,
  useFactory: async () => {
    const url = process.env.AMQP_URL;
    if (!url) {
      logger.warn('AMQP_URL not set — using in-memory event bus (single-node dev mode)');
      return new InMemoryEventBus();
    }
    const bus = new RabbitMqEventBus({ url, logger });
    await bus.connect();
    return bus;
  },
};

@Module({
  imports: [AuthModule],
  controllers: [
    HealthController,
    OrgsController,
    ProjectsController,
    VideosController,
    EditorController,
    LibraryController,
    BrandsWorkflowsController,
    BrandExtractController,
    AdminController,
    DeveloperController,
    StatsController,
    BillingAdminController,
    BillingController,
    BillingWebhookController,
  ],
  providers: [
    PrismaService,
    BillingService,
    storageProvider,
    VideosService,
    ProgressGateway,
    eventBusProvider,
    { provide: EVENT_SUBSCRIBER, useExisting: EVENT_BUS },
    { provide: MetricsRegistry, useValue: new MetricsRegistry({ service: 'surfgen-api', defaultMetrics: true }) },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
