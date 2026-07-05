import { describe, expect, test, vi } from 'vitest';
import { NotFoundError } from '@surfgen/core';
import { VideosService } from '../src/videos/videos.service';

const ORG_ID = 'org_1';
const OTHER_ORG_ID = 'org_2';
const PROJECT_ID = 'project_1';
const USER_ID = 'user_1';

const baseInput = {
  title: 'Untitled video',
  language: 'en',
  settings: {
    resolution: { width: 1920, height: 1080 },
    frameRate: 30,
    container: 'mp4',
    codec: 'h264',
    quality: 23,
  },
};

function makeService(options: { avatarOrgId?: string; voiceOrgId?: string } = {}) {
  const prisma = {
    project: {
      findFirst: vi.fn(
        async (): Promise<{ id: string; organizationId: string; deletedAt: null } | null> => ({
          id: PROJECT_ID,
          organizationId: ORG_ID,
          deletedAt: null,
        }),
      ),
    },
    avatar: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
        options.avatarOrgId && where.organizationId === options.avatarOrgId
          ? { id: where.id, organizationId: options.avatarOrgId }
          : null,
      ),
    },
    voice: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; organizationId: string } }) =>
        options.voiceOrgId && where.organizationId === options.voiceOrgId
          ? { id: where.id, organizationId: options.voiceOrgId }
          : null,
      ),
    },
    video: { create: vi.fn(async () => ({ id: 'video_1', title: baseInput.title })) },
  };
  const events = { publish: vi.fn(async () => undefined) };
  const service = new VideosService(prisma as never, events as never);
  return { service, prisma, events };
}

describe('VideosService.create — avatar/voice org scoping', () => {
  test('rejects an avatarId that belongs to a different org', async () => {
    const { service } = makeService({ avatarOrgId: OTHER_ORG_ID });
    await expect(
      service.create(ORG_ID, PROJECT_ID, USER_ID, { ...baseInput, avatarId: 'avatar_1' }),
    ).rejects.toThrow(NotFoundError);
  });

  test('rejects a voiceId that belongs to a different org', async () => {
    const { service } = makeService({ voiceOrgId: OTHER_ORG_ID });
    await expect(
      service.create(ORG_ID, PROJECT_ID, USER_ID, { ...baseInput, voiceId: 'voice_1' }),
    ).rejects.toThrow(NotFoundError);
  });

  test('accepts an avatarId and voiceId that belong to the caller\'s org', async () => {
    const { service, prisma } = makeService({ avatarOrgId: ORG_ID, voiceOrgId: ORG_ID });
    await expect(
      service.create(ORG_ID, PROJECT_ID, USER_ID, { ...baseInput, avatarId: 'avatar_1', voiceId: 'voice_1' }),
    ).resolves.toBeDefined();
    expect(prisma.video.create).toHaveBeenCalledTimes(1);
  });

  test('skips avatar/voice checks entirely when neither is provided', async () => {
    const { service, prisma } = makeService();
    await expect(service.create(ORG_ID, PROJECT_ID, USER_ID, baseInput)).resolves.toBeDefined();
    expect(prisma.avatar.findFirst).not.toHaveBeenCalled();
    expect(prisma.voice.findFirst).not.toHaveBeenCalled();
    expect(prisma.video.create).toHaveBeenCalledTimes(1);
  });

  test('still rejects a project from a different org (existing behavior)', async () => {
    const { service, prisma } = makeService();
    prisma.project.findFirst = vi.fn(async () => null);
    await expect(service.create(ORG_ID, PROJECT_ID, USER_ID, baseInput)).rejects.toThrow(NotFoundError);
  });
});
