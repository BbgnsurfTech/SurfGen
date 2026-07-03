import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NotFoundError } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Principal, RequireOrgRole, type AuthenticatedPrincipal } from '../auth/guards';

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, 'lowercase letters, digits, hyphens')
    .optional(),
});

const UpdateOrgSchema = z.object({ name: z.string().min(1).max(120).optional() });

const InviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']).default('editor'),
});

@ApiTags('organizations')
@ApiBearerAuth()
@Controller({ path: 'orgs', version: '1' })
export class OrgsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async listMine(@Principal() principal: AuthenticatedPrincipal) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId: principal.userId },
      include: { organization: true },
    });
    return memberships
      .filter((m) => !m.organization.deletedAt)
      .map((m) => ({ ...m.organization, role: m.role }));
  }

  @Post()
  async create(
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(CreateOrgSchema)) body: z.infer<typeof CreateOrgSchema>,
  ) {
    const slug = body.slug ?? body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    return this.prisma.organization.create({
      data: {
        name: body.name,
        slug,
        memberships: { create: { userId: principal.userId, role: 'owner' } },
      },
    });
  }

  @Get(':orgId')
  @RequireOrgRole('viewer')
  async get(@Param('orgId') orgId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      include: { memberships: { include: { user: { select: { id: true, email: true, name: true } } } } },
    });
    if (!org) throw new NotFoundError('Organization', orgId);
    return org;
  }

  @Patch(':orgId')
  @RequireOrgRole('admin')
  async update(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(UpdateOrgSchema)) body: z.infer<typeof UpdateOrgSchema>,
  ) {
    return this.prisma.organization.update({ where: { id: orgId }, data: body });
  }

  @Delete(':orgId')
  @RequireOrgRole('owner')
  async softDelete(@Param('orgId') orgId: string) {
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  @Post(':orgId/members')
  @RequireOrgRole('admin')
  async inviteMember(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(InviteMemberSchema)) body: z.infer<typeof InviteMemberSchema>,
  ) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw new NotFoundError('User', body.email);
    return this.prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
      update: { role: body.role },
      create: { userId: user.id, organizationId: orgId, role: body.role },
    });
  }

  @Delete(':orgId/members/:userId')
  @RequireOrgRole('admin')
  async removeMember(@Param('orgId') orgId: string, @Param('userId') userId: string) {
    await this.prisma.membership.deleteMany({ where: { organizationId: orgId, userId } });
    return { removed: true };
  }
}
