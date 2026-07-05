import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '@surfgen/core';
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
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(InviteMemberSchema)) body: z.infer<typeof InviteMemberSchema>,
  ) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw new NotFoundError('User', body.email);
    const existing = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
    });
    if (existing?.role === 'owner') {
      await this.assertCanActOnOwner(orgId, principal.userId);
    }
    return this.prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
      update: { role: body.role },
      create: { userId: user.id, organizationId: orgId, role: body.role },
    });
  }

  @Delete(':orgId/members/:userId')
  @RequireOrgRole('admin')
  async removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Principal() principal: AuthenticatedPrincipal,
  ) {
    const target = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    });
    if (!target) return { removed: false };
    if (target.role === 'owner') {
      await this.assertCanActOnOwner(orgId, principal.userId);
    }
    await this.prisma.membership.deleteMany({ where: { organizationId: orgId, userId } });
    return { removed: true };
  }

  /**
   * Guards any role change or removal targeting an existing owner: only
   * another owner may act on an owner, and the org must always keep at
   * least one owner left afterward.
   */
  private async assertCanActOnOwner(orgId: string, callerId: string): Promise<void> {
    const caller = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: callerId, organizationId: orgId } },
    });
    if (caller?.role !== 'owner') {
      throw new ForbiddenError("Only an owner can change another owner's role or remove them");
    }
    const ownerCount = await this.prisma.membership.count({ where: { organizationId: orgId, role: 'owner' } });
    if (ownerCount <= 1) {
      throw new ForbiddenError('Cannot remove or demote the last owner of an organization');
    }
  }
}
