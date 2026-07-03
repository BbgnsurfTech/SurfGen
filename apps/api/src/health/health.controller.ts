import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MetricsRegistry } from '@surfgen/telemetry';
import { PrismaService } from '../common/prisma.service';
import { Public } from '../auth/guards';

@ApiTags('system')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsRegistry,
  ) {}

  @Public()
  @Get('healthz')
  health() {
    return { status: 'ok', service: 'surfgen-api' };
  }

  @Public()
  @Get('readyz')
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ready' };
  }

  @Public()
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4')
  metricsText() {
    return this.metrics.metricsText();
  }
}
