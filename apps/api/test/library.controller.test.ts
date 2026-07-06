import { describe, expect, test, vi } from 'vitest';
import { NotFoundError } from '@surfgen/core';
import { LibraryController } from '../src/workspace/library.controller';

const ORG_ID = 'org_1';
const AVATAR_ID = 'avatar_1';
const QUERY = { limit: 20 };

function makeController(avatarRows: { id: string }[] = []) {
  const prisma = {
    avatar: {
      findMany: vi.fn(async () => avatarRows),
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
    await controller.listAvatars(ORG_ID, QUERY);
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
    await controller.listVoices(ORG_ID, QUERY);
    expect(prisma.voice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
  });
});

describe('LibraryController — pagination', () => {
  test('listAvatars fetches limit+1 rows and resumes from the cursor', async () => {
    const { controller, prisma } = makeController();
    await controller.listAvatars(ORG_ID, { limit: 2, cursor: 'avatar_2' });
    expect(prisma.avatar.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3, cursor: { id: 'avatar_2' }, skip: 1 }),
    );
  });

  test('listAvatars trims the sentinel row and returns the next cursor', async () => {
    const { controller } = makeController([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    const result = await controller.listAvatars(ORG_ID, { limit: 2 });
    expect(result.data.map((a: { id: string }) => a.id)).toEqual(['a1', 'a2']);
    expect(result.meta.cursor).toBe('a2');
  });

  test('listVoices returns a null cursor when the page is not full', async () => {
    const { controller } = makeController();
    const result = await controller.listVoices(ORG_ID, QUERY);
    expect(result.meta.cursor).toBeNull();
  });
});
