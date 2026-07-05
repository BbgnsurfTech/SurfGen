import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { NotFoundError, ValidationError, type StoragePort } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
import { STORAGE } from '../common/storage.provider';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { RequireOrgRole } from '../auth/guards';

const UpdateVideoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  language: z.string().min(2).max(35).optional(),
});

const SceneContentSchema = z
  .object({
    name: z.string().max(120).optional(),
    script: z.string().max(20_000).optional(),
    avatarId: z.string().optional(),
    voiceId: z.string().optional(),
  })
  .passthrough();

const CreateSceneSchema = z.object({
  content: SceneContentSchema.default({}),
  durationMs: z.number().int().positive().optional(),
});

const UpdateSceneSchema = z.object({
  content: SceneContentSchema.optional(),
  durationMs: z.number().int().positive().nullable().optional(),
  order: z.number().int().min(0).optional(),
});

const OUTPUT_URL_TTL_SECONDS = 15 * 60;

/** Editor persistence: scene/script editing + signed access to the rendered output. */
@ApiTags('editor')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId/projects/:projectId/videos/:videoId', version: '1' })
export class EditorController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE) private readonly storage: StoragePort,
  ) {}

  private async requireVideo(orgId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, organizationId: orgId, deletedAt: null },
    });
    if (!video) throw new NotFoundError('Video', videoId);
    return video;
  }

  @Patch()
  @RequireOrgRole('editor')
  async updateVideo(
    @Param('orgId') orgId: string,
    @Param('videoId') videoId: string,
    @Body(new ZodValidationPipe(UpdateVideoSchema)) body: z.infer<typeof UpdateVideoSchema>,
  ) {
    await this.requireVideo(orgId, videoId);
    return this.prisma.video.update({ where: { id: videoId }, data: body });
  }

  @Post('scenes')
  @RequireOrgRole('editor')
  async createScene(
    @Param('orgId') orgId: string,
    @Param('videoId') videoId: string,
    @Body(new ZodValidationPipe(CreateSceneSchema)) body: z.infer<typeof CreateSceneSchema>,
  ) {
    await this.requireVideo(orgId, videoId);
    const last = await this.prisma.scene.findFirst({ where: { videoId }, orderBy: { order: 'desc' } });
    return this.prisma.scene.create({
      data: {
        videoId,
        order: (last?.order ?? -1) + 1,
        content: body.content as never,
        ...(body.durationMs !== undefined && { durationMs: body.durationMs }),
      },
    });
  }

  @Patch('scenes/:sceneId')
  @RequireOrgRole('editor')
  async updateScene(
    @Param('orgId') orgId: string,
    @Param('videoId') videoId: string,
    @Param('sceneId') sceneId: string,
    @Body(new ZodValidationPipe(UpdateSceneSchema)) body: z.infer<typeof UpdateSceneSchema>,
  ) {
    await this.requireVideo(orgId, videoId);
    const scene = await this.prisma.scene.findFirst({ where: { id: sceneId, videoId } });
    if (!scene) throw new NotFoundError('Scene', sceneId);
    // Merge content so a script edit never clobbers avatar/voice assignments.
    const content = body.content
      ? { ...(scene.content as Record<string, unknown>), ...body.content }
      : undefined;
    return this.prisma.scene.update({
      where: { id: sceneId },
      data: {
        ...(content && { content: content as never }),
        ...(body.durationMs !== undefined && { durationMs: body.durationMs }),
        ...(body.order !== undefined && { order: body.order }),
      },
    });
  }

  @Delete('scenes/:sceneId')
  @RequireOrgRole('editor')
  async deleteScene(
    @Param('orgId') orgId: string,
    @Param('videoId') videoId: string,
    @Param('sceneId') sceneId: string,
  ) {
    await this.requireVideo(orgId, videoId);
    const scene = await this.prisma.scene.findFirst({ where: { id: sceneId, videoId } });
    if (!scene) throw new NotFoundError('Scene', sceneId);
    await this.prisma.scene.delete({ where: { id: sceneId } });
    return { deleted: true };
  }

  @Get('output')
  @RequireOrgRole('viewer')
  async output(@Param('orgId') orgId: string, @Param('videoId') videoId: string) {
    const video = await this.requireVideo(orgId, videoId);
    const output = video.output as {
      media?: { storageKey: string; contentType: string; durationMs: number };
      thumbnail?: { storageKey: string; contentType: string } | null;
    } | null;
    if (video.status !== 'ready' || !output?.media) {
      throw new ValidationError('video has no rendered output yet');
    }
    const [media, thumbnail] = await Promise.all([
      this.storage.signedUrl(output.media.storageKey, {
        method: 'GET',
        expiresInSeconds: OUTPUT_URL_TTL_SECONDS,
      }),
      output.thumbnail
        ? this.storage.signedUrl(output.thumbnail.storageKey, {
            method: 'GET',
            expiresInSeconds: OUTPUT_URL_TTL_SECONDS,
          })
        : Promise.resolve(null),
    ]);
    return { media, thumbnail, expiresInSeconds: OUTPUT_URL_TTL_SECONDS };
  }
}
