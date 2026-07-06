import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NotFoundError } from '@surfgen/core';
import { ListQuerySchema, cursorArgs, pageResult, type ListQuery } from '../common/list-query';
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequireOrgRole } from '../auth/guards';

const CreateAvatarSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['photo', 'video', 'three_d', 'animated_character']),
  providerId: z.string().min(1).optional(),
});

const CreateVoiceSchema = z.object({
  name: z.string().min(1).max(120),
  language: z.string().min(2).max(35),
  providerId: z.string().min(1),
  externalId: z.string().min(1),
});

@ApiTags('library')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId', version: '1' })
export class LibraryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('avatars')
  @RequireOrgRole('viewer')
  async listAvatars(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery,
  ) {
    const avatars = await this.prisma.avatar.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { versions: { where: { isActive: true }, take: 1 } },
      ...cursorArgs(query),
    });
    return pageResult(avatars, query.limit);
  }

  @Post('avatars')
  @RequireOrgRole('editor')
  createAvatar(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateAvatarSchema)) body: z.infer<typeof CreateAvatarSchema>,
  ) {
    return this.prisma.avatar.create({ data: { organizationId: orgId, ...body } });
  }

  @Delete('avatars/:avatarId')
  @RequireOrgRole('editor')
  async deleteAvatar(@Param('orgId') orgId: string, @Param('avatarId') avatarId: string) {
    const avatar = await this.prisma.avatar.findFirst({
      where: { id: avatarId, organizationId: orgId, deletedAt: null },
    });
    if (!avatar) throw new NotFoundError('Avatar', avatarId);
    return this.prisma.avatar.update({ where: { id: avatarId }, data: { deletedAt: new Date() } });
  }

  @Get('voices')
  @RequireOrgRole('viewer')
  async listVoices(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(ListQuerySchema)) query: ListQuery,
  ) {
    const voices = await this.prisma.voice.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(query),
    });
    return pageResult(voices, query.limit);
  }

  // Non-cloned voices only: cloning requires a consent token and runs through
  // the pipeline (VoiceCloneInput in @surfgen/ai-sdk), not a plain CRUD call.
  @Post('voices')
  @RequireOrgRole('editor')
  createVoice(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(CreateVoiceSchema)) body: z.infer<typeof CreateVoiceSchema>,
  ) {
    return this.prisma.voice.create({ data: { organizationId: orgId, ...body } });
  }
}
