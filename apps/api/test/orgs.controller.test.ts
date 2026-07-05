import { describe, expect, test, vi } from 'vitest';
import { ForbiddenError, NotFoundError } from '@surfgen/core';
import { OrgsController } from '../src/orgs/orgs.controller';
import type { AuthenticatedPrincipal } from '../src/auth/guards';

const ORG_ID = 'org_1';
const CALLER_ID = 'user_admin';
const TARGET_ID = 'user_target';

function principal(overrides: Partial<AuthenticatedPrincipal> = {}): AuthenticatedPrincipal {
  return { userId: CALLER_ID, superAdmin: false, ...overrides };
}

function makeController(options: {
  callerRole: 'owner' | 'admin';
  targetRole?: 'owner' | 'admin' | 'editor' | 'viewer';
  ownerCount?: number;
}) {
  const membershipsByUser: Record<string, { role: string } | undefined> = {
    [CALLER_ID]: { role: options.callerRole },
    ...(options.targetRole !== undefined && { [TARGET_ID]: { role: options.targetRole } }),
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async (): Promise<{ id: string; email: string } | null> => ({
        id: TARGET_ID,
        email: 'target@example.com',
      })),
    },
    membership: {
      findUnique: vi.fn(async ({ where }: { where: { userId_organizationId: { userId: string } } }) =>
        membershipsByUser[where.userId_organizationId.userId] ?? null,
      ),
      count: vi.fn(async () => options.ownerCount ?? 1),
      upsert: vi.fn(async () => ({ userId: TARGET_ID, organizationId: ORG_ID, role: 'editor' })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const controller = new OrgsController(prisma as never);
  return { controller, prisma };
}

describe('OrgsController.inviteMember — owner protection', () => {
  test('an admin cannot change an existing owner\'s role', async () => {
    const { controller } = makeController({ callerRole: 'admin', targetRole: 'owner', ownerCount: 2 });
    await expect(
      controller.inviteMember(ORG_ID, principal(), { email: 'target@example.com', role: 'viewer' }),
    ).rejects.toThrow(ForbiddenError);
  });

  test('an owner can change another owner\'s role when a second owner remains', async () => {
    const { controller, prisma } = makeController({ callerRole: 'owner', targetRole: 'owner', ownerCount: 2 });
    await expect(
      controller.inviteMember(ORG_ID, principal(), { email: 'target@example.com', role: 'viewer' }),
    ).resolves.toBeDefined();
    expect(prisma.membership.upsert).toHaveBeenCalledTimes(1);
  });

  test('an owner cannot demote the last remaining owner', async () => {
    const { controller } = makeController({ callerRole: 'owner', targetRole: 'owner', ownerCount: 1 });
    await expect(
      controller.inviteMember(ORG_ID, principal(), { email: 'target@example.com', role: 'viewer' }),
    ).rejects.toThrow(ForbiddenError);
  });

  test('changing a non-owner member\'s role is unaffected', async () => {
    const { controller, prisma } = makeController({ callerRole: 'admin', targetRole: 'editor' });
    await expect(
      controller.inviteMember(ORG_ID, principal(), { email: 'target@example.com', role: 'admin' }),
    ).resolves.toBeDefined();
    expect(prisma.membership.upsert).toHaveBeenCalledTimes(1);
  });

  test('inviting a brand-new member is unaffected', async () => {
    const { controller, prisma } = makeController({ callerRole: 'admin' });
    await expect(
      controller.inviteMember(ORG_ID, principal(), { email: 'target@example.com', role: 'editor' }),
    ).resolves.toBeDefined();
    expect(prisma.membership.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('OrgsController.removeMember — owner protection', () => {
  test('an admin cannot remove an owner', async () => {
    const { controller } = makeController({ callerRole: 'admin', targetRole: 'owner', ownerCount: 2 });
    await expect(controller.removeMember(ORG_ID, TARGET_ID, principal())).rejects.toThrow(ForbiddenError);
  });

  test('an owner can remove another owner when a second owner remains', async () => {
    const { controller, prisma } = makeController({ callerRole: 'owner', targetRole: 'owner', ownerCount: 2 });
    await expect(controller.removeMember(ORG_ID, TARGET_ID, principal())).resolves.toEqual({ removed: true });
    expect(prisma.membership.deleteMany).toHaveBeenCalledTimes(1);
  });

  test('cannot remove the last remaining owner, even by another owner', async () => {
    const { controller } = makeController({ callerRole: 'owner', targetRole: 'owner', ownerCount: 1 });
    await expect(controller.removeMember(ORG_ID, TARGET_ID, principal())).rejects.toThrow(ForbiddenError);
  });

  test('removing a non-owner member is unaffected', async () => {
    const { controller, prisma } = makeController({ callerRole: 'admin', targetRole: 'editor' });
    await expect(controller.removeMember(ORG_ID, TARGET_ID, principal())).resolves.toEqual({ removed: true });
    expect(prisma.membership.deleteMany).toHaveBeenCalledTimes(1);
  });

  test('removing a membership that does not exist is a no-op, not an error', async () => {
    const { controller, prisma } = makeController({ callerRole: 'admin' });
    await expect(controller.removeMember(ORG_ID, TARGET_ID, principal())).resolves.toEqual({ removed: false });
    expect(prisma.membership.deleteMany).not.toHaveBeenCalled();
  });
});

describe('OrgsController.inviteMember — unrelated behavior', () => {
  test('still 404s when the invited email has no account', async () => {
    const { controller, prisma } = makeController({ callerRole: 'admin' });
    prisma.user.findUnique = vi.fn(async () => null);
    await expect(
      controller.inviteMember(ORG_ID, principal(), { email: 'nobody@example.com', role: 'editor' }),
    ).rejects.toThrow(NotFoundError);
  });
});
