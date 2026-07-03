import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NotFoundError } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequireOrgRole } from '../auth/guards';

const HEX = /^#[0-9a-fA-F]{6}$/;
const BrandColorsSchema = z.object({
  primary: z.string().regex(HEX),
  secondary: z.string().regex(HEX),
  ink: z.string().regex(HEX),
  surface: z.string().regex(HEX),
});
const BrandFontsSchema = z.object({ display: z.string().min(1), body: z.string().min(1) });

const CreateBrandKitSchema = z.object({
  name: z.string().min(1).max(120),
  sourceUrl: z.string().max(300).optional(),
  colors: BrandColorsSchema,
  fonts: BrandFontsSchema,
});
const UpdateBrandKitSchema = CreateBrandKitSchema.partial();

const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(120),
  definition: z.record(z.string(), z.unknown()),
  projectId: z.string().optional(),
});
const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  definition: z.record(z.string(), z.unknown()).optional(),
  isEnabled: z.boolean().optional(),
});

@ApiTags('brand-kits', 'workflows')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId', version: '1' })
export class BrandsWorkflowsController {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------- brand kits
  @Get('brand-kits')
  @RequireOrgRole('viewer')
  listBrandKits(@Param('orgId') orgId: string) {
    return this.prisma.brandKit.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }

  @Post('brand-kits')
  @RequireOrgRole('editor')
  createBrandKit(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateBrandKitSchema)) body: z.infer<typeof CreateBrandKitSchema>,
  ) {
    return this.prisma.brandKit.create({ data: { organizationId: orgId, ...body } });
  }

  @Patch('brand-kits/:brandKitId')
  @RequireOrgRole('editor')
  async updateBrandKit(
    @Param('orgId') orgId: string,
    @Param('brandKitId') brandKitId: string,
    @Body(new ZodValidationPipe(UpdateBrandKitSchema)) body: z.infer<typeof UpdateBrandKitSchema>,
  ) {
    const kit = await this.prisma.brandKit.findFirst({ where: { id: brandKitId, organizationId: orgId } });
    if (!kit) throw new NotFoundError('BrandKit', brandKitId);
    return this.prisma.brandKit.update({ where: { id: brandKitId }, data: body });
  }

  @Delete('brand-kits/:brandKitId')
  @RequireOrgRole('editor')
  async deleteBrandKit(@Param('orgId') orgId: string, @Param('brandKitId') brandKitId: string) {
    const kit = await this.prisma.brandKit.findFirst({ where: { id: brandKitId, organizationId: orgId } });
    if (!kit) throw new NotFoundError('BrandKit', brandKitId);
    return this.prisma.brandKit.update({ where: { id: brandKitId }, data: { deletedAt: new Date() } });
  }

  // -------------------------------------------------------------- workflows
  @Get('workflows')
  @RequireOrgRole('viewer')
  listWorkflows(@Param('orgId') orgId: string) {
    return this.prisma.workflow.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' } });
  }

  @Post('workflows')
  @RequireOrgRole('editor')
  createWorkflow(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateWorkflowSchema)) body: z.infer<typeof CreateWorkflowSchema>,
  ) {
    return this.prisma.workflow.create({
      data: {
        organizationId: orgId,
        name: body.name,
        definition: body.definition as object,
        ...(body.projectId && { projectId: body.projectId }),
      },
    });
  }

  @Patch('workflows/:workflowId')
  @RequireOrgRole('editor')
  async updateWorkflow(
    @Param('orgId') orgId: string,
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(UpdateWorkflowSchema)) body: z.infer<typeof UpdateWorkflowSchema>,
  ) {
    const workflow = await this.prisma.workflow.findFirst({ where: { id: workflowId, organizationId: orgId } });
    if (!workflow) throw new NotFoundError('Workflow', workflowId);
    return this.prisma.workflow.update({
      where: { id: workflowId },
      data: {
        ...(body.name && { name: body.name }),
        ...(body.definition && { definition: body.definition as object, version: { increment: 1 } }),
        ...(body.isEnabled !== undefined && { isEnabled: body.isEnabled }),
      },
    });
  }
}
