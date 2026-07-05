import { resolve } from 'node:path';
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { loadAll, type ConfigBundle } from '@surfgen/config';
import { NotFoundError, unwrap } from '@surfgen/core';
import { RequireSuperAdmin } from '../auth/guards';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const TogglePluginSchema = z.object({ enabled: z.boolean() });

const RUNNING_JOB_LIMIT = 12;

/**
 * Deployment-level admin data. Providers come straight from the config files
 * (the same files the workers resolve against — the single source of truth
 * for the config-only vendor swap); plugins from the Plugin table (workers
 * self-register their loaded manifests at boot); monitor from the Job table.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ version: '1' })
export class AdminController {
  private config: ConfigBundle | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private bundle(): ConfigBundle {
    if (!this.config) {
      const configDir = process.env.SURFGEN_CONFIG_DIR ?? resolve(process.cwd(), 'config');
      this.config = unwrap(loadAll(configDir));
    }
    return this.config;
  }

  @Get('providers')
  @RequireSuperAdmin() // deployment-wide vendor config, including which secrets each provider requires
  listProviders() {
    const bundle = this.bundle();
    const chainPosition = new Map<string, number>();
    for (const [, capability] of Object.entries(bundle.ai.capabilities)) {
      capability.chain.forEach((link, index) => chainPosition.set(link.provider, index));
    }
    return bundle.providers.providers.map((provider) => ({
      id: provider.id,
      capability: provider.capability,
      kind: provider.kind,
      enabled: provider.enabled,
      priority: provider.priority,
      requiresSecrets: Object.keys(provider.secrets ?? {}),
      chainPosition: chainPosition.get(provider.id) ?? null,
    }));
  }

  @Get('plugins')
  @RequireSuperAdmin() // deployment-wide plugin registry, not org-scoped
  listPlugins() {
    return this.prisma.plugin.findMany({ orderBy: { name: 'asc' } });
  }

  @Patch('plugins/:pluginId')
  @RequireSuperAdmin() // deployment-wide state — org members must not toggle
  async togglePlugin(
    @Param('pluginId') pluginId: string,
    @Body(new ZodValidationPipe(TogglePluginSchema)) body: z.infer<typeof TogglePluginSchema>,
  ) {
    const plugin = await this.prisma.plugin.findUnique({ where: { id: pluginId } });
    if (!plugin) throw new NotFoundError('Plugin', pluginId);
    return this.prisma.plugin.update({ where: { id: pluginId }, data: { enabled: body.enabled } });
  }

  @Get('monitor')
  @RequireSuperAdmin() // job rows span every org (queue names, video titles)
  async monitor() {
    const [queueCounts, running] = await Promise.all([
      this.prisma.job.groupBy({
        by: ['queue', 'status'],
        _count: { _all: true },
        where: { status: { in: ['queued', 'active', 'progress', 'retrying'] } },
      }),
      this.prisma.job.findMany({
        where: { status: { in: ['active', 'progress', 'retrying'] } },
        orderBy: { updatedAt: 'desc' },
        take: RUNNING_JOB_LIMIT,
        include: { pipelineRun: { include: { video: { select: { title: true } } } } },
      }),
    ]);

    const queues: Record<string, { active: number; waiting: number }> = {};
    for (const row of queueCounts) {
      const entry = (queues[row.queue] ??= { active: 0, waiting: 0 });
      if (row.status === 'queued') entry.waiting += row._count._all;
      else entry.active += row._count._all;
    }

    return {
      queues: Object.entries(queues).map(([name, counts]) => ({ name, ...counts })),
      jobs: running.map((job) => ({
        id: job.id,
        stage: job.stage,
        queue: job.queue,
        progress: job.progress,
        videoTitle: job.pipelineRun.video.title,
        startedAt: job.startedAt,
      })),
    };
  }
}
