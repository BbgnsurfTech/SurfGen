import { describe, expect, test, vi } from 'vitest';
import { NotFoundError } from '@surfgen/core';
import { LibraryController } from '../src/workspace/library.controller';

const ORG_ID = 'org_1';
const AVATAR_ID = 'avatar_1';

function makeController() {
  const prisma = {
    avatar: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async (): Promise<{ id: string; organizationId: string } | null> => null),
      update: vi.fn(async () => ({ id: AVATAR_ID })),
    },
    voice: {
      findMany: vi.fn(async () => []),
    },
  };
  const controller = new LibraryController(prisma as never);
  return { controller, prisma };
}

describe('LibraryController — soft-delete filtering', () => {
  test('listAvatars excludes soft-deleted avatars', async () => {
    const { controller, prisma } = makeController();
    await controller.listAvatars(ORG_ID);
    expect(prisma.avatar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  test('deleteAvatar 404s on an already-deleted avatar instead of resurrecting it', async () => {
    const { controller, prisma } = makeController();
    // findFirst mocked to null models the deletedAt:null filter excluding it once fixed.
    await expect(controller.deleteAvatar(ORG_ID, AVATAR_ID)).rejects.toThrow(NotFoundError);
    expect(prisma.avatar.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });

  test('listVoices excludes soft-deleted voices', async () => {
    const { controller, prisma } = makeController();
    await controller.listVoices(ORG_ID);
    expect(prisma.voice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});
