import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NotFoundError } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequireOrgRole } from '../auth/guards';

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  teamId: z.string().optional(),
});

const UpdateProjectSchema = CreateProjectSchema.partial();

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

@ApiTags('projects')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId/projects', version: '1' })
export class ProjectsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireOrgRole('viewer')
  async list(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
    });
    const hasMore = projects.length > query.limit;
    const page = hasMore ? projects.slice(0, -1) : projects;
    return { data: page, meta: { cursor: hasMore ? page.at(-1)?.id : null } };
  }

  @Post()
  @RequireOrgRole('editor')
  async create(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateProjectSchema)) body: z.infer<typeof CreateProjectSchema>,
  ) {
    return this.prisma.project.create({ data: { ...body, organizationId: orgId } });
  }

  @Get(':projectId')
  @RequireOrgRole('viewer')
  async get(@Param('orgId') orgId: string, @Param('projectId') projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
    });
    if (!project) throw new NotFoundError('Project', projectId);
    return project;
  }

  @Patch(':projectId')
  @RequireOrgRole('editor')
  async update(
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) body: z.infer<typeof UpdateProjectSchema>,
  ) {
    await this.get(orgId, projectId); // 404 + org scoping
    return this.prisma.project.update({ where: { id: projectId }, data: body });
  }

  @Delete(':projectId')
  @RequireOrgRole('admin')
  async softDelete(@Param('orgId') orgId: string, @Param('projectId') projectId: string) {
    await this.get(orgId, projectId);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }
}
