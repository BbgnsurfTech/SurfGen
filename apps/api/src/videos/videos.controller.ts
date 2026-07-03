import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SUPPORTED_FRAME_RATES } from '@surfgen/core';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Principal, RequireOrgRole, type AuthenticatedPrincipal } from '../auth/guards';
import { VideosService } from './videos.service';

const CreateVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).default('en'),
  script: z.string().max(50_000).optional(),
  avatarId: z.string().optional(),
  voiceId: z.string().optional(),
  settings: z
    .object({
      resolution: z.object({
        width: z.number().int().positive().multipleOf(2),
        height: z.number().int().positive().multipleOf(2),
      }),
      frameRate: z
        .number()
        .refine((v): v is (typeof SUPPORTED_FRAME_RATES)[number] =>
          (SUPPORTED_FRAME_RATES as readonly number[]).includes(v),
        ),
      container: z.enum(['mp4', 'webm', 'mov']),
      codec: z.enum(['h264', 'h265', 'vp9', 'av1']),
      quality: z.number().int().min(0).max(63),
    })
    .default({
      resolution: { width: 1920, height: 1080 },
      frameRate: 30,
      container: 'mp4',
      codec: 'h264',
      quality: 23,
    }),
});

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

@ApiTags('videos')
@ApiBearerAuth()
@Controller({ path: 'orgs/:orgId/projects/:projectId/videos', version: '1' })
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post()
  @RequireOrgRole('editor')
  create(
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Principal() principal: AuthenticatedPrincipal,
    @Body(new ZodValidationPipe(CreateVideoSchema)) body: z.infer<typeof CreateVideoSchema>,
  ) {
    return this.videos.create(orgId, projectId, principal.userId, body);
  }

  @Get()
  @RequireOrgRole('viewer')
  list(
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ) {
    return this.videos.list(orgId, projectId, query.cursor, query.limit);
  }

  @Get(':videoId')
  @RequireOrgRole('viewer')
  get(@Param('orgId') orgId: string, @Param('videoId') videoId: string) {
    return this.videos.get(orgId, videoId);
  }

  @Post(':videoId/generate')
  @RequireOrgRole('editor')
  generate(@Param('orgId') orgId: string, @Param('videoId') videoId: string) {
    return this.videos.enqueueGeneration(orgId, videoId);
  }

  @Post(':videoId/cancel')
  @RequireOrgRole('editor')
  cancel(@Param('orgId') orgId: string, @Param('videoId') videoId: string) {
    return this.videos.cancel(orgId, videoId);
  }

  @Delete(':videoId')
  @RequireOrgRole('editor')
  async remove(@Param('orgId') orgId: string, @Param('videoId') videoId: string) {
    await this.videos.softDelete(orgId, videoId);
    return { deleted: true };
  }
}
