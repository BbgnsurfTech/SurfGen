import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma.service';
import { RequireOrgRole } from '../auth/guards';

const MS_PER_MINUTE = 60_000;

@ApiTags('stats')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId/stats', version: '1' })
export class StatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireOrgRole('viewer')
  async get(@Param('orgId') orgId: string) {
    const [videosTotal, videosReady, jobsInFlight, workflowsActive, completedRuns] = await Promise.all([
      this.prisma.video.count({ where: { organizationId: orgId } }),
      this.prisma.video.count({ where: { organizationId: orgId, status: 'ready' } }),
      this.prisma.job.count({
        where: {
          status: { in: ['queued', 'active', 'progress', 'retrying'] },
          pipelineRun: { organizationId: orgId },
        },
      }),
      this.prisma.workflow.count({ where: { organizationId: orgId, isEnabled: true } }),
      this.prisma.pipelineRun.findMany({
        where: { organizationId: orgId, status: 'completed', startedAt: { not: null }, finishedAt: { not: null } },
        select: { startedAt: true, finishedAt: true },
        orderBy: { finishedAt: 'desc' },
        take: 50,
      }),
    ]);

    const durations = completedRuns
      .map((run) => (run.finishedAt!.getTime() - run.startedAt!.getTime()) / MS_PER_MINUTE)
      .filter((minutes) => minutes > 0);
    const avgRenderMinutes = durations.length
      ? durations.reduce((sum, minutes) => sum + minutes, 0) / durations.length
      : null;

    return { videosTotal, videosReady, jobsInFlight, workflowsActive, avgRenderMinutes };
  }
}
