import { describe, expect, test } from 'vitest';
import { resolveAvatarImage } from '../src/stages/handlers.js';

interface FakeAvatar {
  id: string;
  organizationId: string;
  kind: string;
  deletedAt: Date | null;
}

interface FakeAvatarVersion {
  avatarId: string;
  isActive: boolean;
  artifacts: unknown;
}

function fakePrisma(avatars: FakeAvatar[], versions: FakeAvatarVersion[]) {
  return {
    avatar: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string; deletedAt: null } }) =>
        avatars.find(
          (a) => a.id === where.id && a.organizationId === where.organizationId && a.deletedAt === null,
        ) ?? null,
    },
    avatarVersion: {
      findFirst: async ({ where }: { where: { avatarId: string; isActive: boolean } }) =>
        versions.find((v) => v.avatarId === where.avatarId && v.isActive === where.isActive) ?? null,
    },
  };
}

describe('resolveAvatarImage', () => {
  test('returns the active version source image for a photo avatar', async () => {
    const sourceImage = { storageKey: 'org/o1/assets/a1/photo.png', contentType: 'image/png' };
    const prisma = fakePrisma(
      [{ id: 'a1', organizationId: 'o1', kind: 'photo', deletedAt: null }],
      [{ avatarId: 'a1', isActive: true, artifacts: { sourceImage } }],
    );
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toEqual(sourceImage);
  });

  test('returns null when the avatar does not exist', async () => {
    const prisma = fakePrisma([], []);
    await expect(resolveAvatarImage(prisma, 'o1', 'missing')).resolves.toBeNull();
  });

  test('returns null for a non-photo avatar kind', async () => {
    const prisma = fakePrisma(
      [{ id: 'a1', organizationId: 'o1', kind: 'video', deletedAt: null }],
      [{ avatarId: 'a1', isActive: true, artifacts: { sourceImage: { storageKey: 'x', contentType: 'video/mp4' } } }],
    );
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toBeNull();
  });

  test('returns null when the avatar belongs to a different org', async () => {
    const prisma = fakePrisma(
      [{ id: 'a1', organizationId: 'other-org', kind: 'photo', deletedAt: null }],
      [{ avatarId: 'a1', isActive: true, artifacts: { sourceImage: { storageKey: 'x', contentType: 'image/png' } } }],
    );
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toBeNull();
  });

  test('returns null when no active version exists', async () => {
    const prisma = fakePrisma([{ id: 'a1', organizationId: 'o1', kind: 'photo', deletedAt: null }], []);
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toBeNull();
  });

  test('returns null when the active version has no sourceImage artifact', async () => {
    const prisma = fakePrisma(
      [{ id: 'a1', organizationId: 'o1', kind: 'photo', deletedAt: null }],
      [{ avatarId: 'a1', isActive: true, artifacts: {} }],
    );
    await expect(resolveAvatarImage(prisma, 'o1', 'a1')).resolves.toBeNull();
  });
});
