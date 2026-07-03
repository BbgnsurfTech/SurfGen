import { Injectable } from '@nestjs/common';
import {
  InvalidStateTransitionError,
  NotFoundError,
  VIDEO_TRANSITIONS,
  canTransition,
  type VideoStatus,
} from '@surfgen/core';
import { createEnvelope, type InMemoryEventBus } from '@surfgen/events';
import type { EventPublisherPort } from '@surfgen/core';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export const EVENT_BUS = Symbol('EVENT_BUS');

export interface CreateVideoInput {
  title: string;
  description?: string;
  language: string;
  script?: string;
  avatarId?: string;
  voiceId?: string;
  settings: {
    resolution: { width: number; height: number };
    frameRate: number;
    container: string;
    codec: string;
    quality: number;
  };
}

@Injectable()
export class VideosService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly events: EventPublisherPort | InMemoryEventBus,
  ) {}

  async create(orgId: string, projectId: string, userId: string, input: CreateVideoInput) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId, deletedAt: null },
    });
    if (!project) throw new NotFoundError('Project', projectId);

    const video = await this.prisma.video.create({
      data: {
        organizationId: orgId,
        projectId,
        createdById: userId,
        title: input.title,
        description: input.description ?? null,
        language: input.language,
        settings: input.settings,
        pipeline: input.script
          ? { script: input.script, avatarId: input.avatarId, voiceId: input.voiceId }
          : undefined,
      },
    });

    await this.events.publish(
      createEnvelope({
        name: 'video.created',
        organizationId: orgId,
        payload: { videoId: video.id, projectId, title: video.title },
      }),
    );
    return video;
  }

  async list(orgId: string, projectId: string, cursor: string | undefined, limit: number) {
    const videos = await this.prisma.video.findMany({
      where: { organizationId: orgId, projectId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const hasMore = videos.length > limit;
    const page = hasMore ? videos.slice(0, -1) : videos;
    return { data: page, meta: { cursor: hasMore ? page.at(-1)?.id : null } };
  }

  async get(orgId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, organizationId: orgId, deletedAt: null },
      include: {
        scenes: {
          orderBy: { order: 'asc' },
          include: { tracks: { orderBy: { order: 'asc' }, include: { clips: { orderBy: { startMs: 'asc' } } } } },
        },
        pipelineRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!video) throw new NotFoundError('Video', videoId);
    return video;
  }

  /**
   * Queue a video for generation. Persists the transition and emits
   * video.queued — the pipeline orchestrator (worker side) picks it up.
   */
  async enqueueGeneration(orgId: string, videoId: string) {
    const video = await this.get(orgId, videoId);
    this.assertTransition(video.status as VideoStatus, 'queued');

    const [updated, run] = await this.prisma.$transaction([
      this.prisma.video.update({ where: { id: videoId }, data: { status: 'queued' } }),
      this.prisma.pipelineRun.create({
        data: {
          videoId,
          organizationId: orgId,
          definition: (video.pipeline ?? {}) as object,
          status: 'pending',
        },
      }),
    ]);

    await this.events.publish(
      createEnvelope({
        name: 'video.queued',
        organizationId: orgId,
        correlationId: run.id,
        payload: { videoId, runId: run.id },
      }),
    );
    return { video: updated, runId: run.id };
  }

  async cancel(orgId: string, videoId: string) {
    const video = await this.get(orgId, videoId);
    this.assertTransition(video.status as VideoStatus, 'cancelled');

    const updated = await this.prisma.video.update({
      where: { id: videoId },
      data: { status: 'cancelled' },
    });
    await this.prisma.pipelineRun.updateMany({
      where: { videoId, status: { in: ['pending', 'running'] } },
      data: { status: 'cancelled', finishedAt: new Date() },
    });
    await this.events.publish(
      createEnvelope({
        name: 'video.cancelled',
        organizationId: orgId,
        payload: { videoId },
      }),
    );
    return updated;
  }

  async softDelete(orgId: string, videoId: string) {
    await this.get(orgId, videoId);
    await this.prisma.video.update({ where: { id: videoId }, data: { deletedAt: new Date() } });
  }

  private assertTransition(from: VideoStatus, to: VideoStatus): void {
    if (!canTransition(VIDEO_TRANSITIONS, from, to)) {
      throw new InvalidStateTransitionError('Video', from, to);
    }
  }
}
