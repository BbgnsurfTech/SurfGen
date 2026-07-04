import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { UnauthorizedError } from '@surfgen/core';
import { AuthService } from '../src/auth/auth.service';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const FUTURE = new Date(Date.now() + 3600_000);
const PAST = new Date(Date.now() - 3600_000);

const baseUser = {
  id: 'user_1',
  email: 'ada@example.com',
  name: 'Ada',
  isSuperAdmin: false,
  deletedAt: null,
  emailVerifiedAt: null as Date | null,
};

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    user: {
      findUnique: vi.fn(async () => null as unknown),
      create: vi.fn(async () => baseUser),
      update: vi.fn(async () => baseUser),
    },
    organization: { create: vi.fn(async () => ({})) },
    refreshToken: { create: vi.fn(async () => ({})) },
    emailVerificationToken: {
      create: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => null as unknown),
      update: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
    ...overrides,
  };
  const jwt = { signAsync: vi.fn(async () => 'signed-jwt'), verifyAsync: vi.fn() };
  const mailer = { isConfigured: false, sendVerificationEmail: vi.fn(async () => undefined) };
  const service = new AuthService(prisma as never, jwt as never, mailer as never);
  return { service, prisma, jwt, mailer };
}

afterEach(() => {
  delete process.env.REQUIRE_EMAIL_VERIFICATION;
});

describe('verifyEmail', () => {
  test('valid token marks it used, verifies the user, and signs in', async () => {
    // Arrange
    const { service, prisma } = makeService();
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      userId: baseUser.id,
      usedAt: null,
      expiresAt: FUTURE,
      user: baseUser,
    });

    // Act
    const tokens = await service.verifyEmail('sgv_valid');

    // Assert
    expect(tokens.accessToken).toBe('signed-jwt');
    expect(prisma.emailVerificationToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha256('sgv_valid') } }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['expired', { usedAt: null, expiresAt: PAST }],
    ['already used', { usedAt: new Date(), expiresAt: FUTURE }],
  ])('rejects a %s token', async (_label, tokenState) => {
    const { service, prisma } = makeService();
    prisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      userId: baseUser.id,
      user: baseUser,
      ...tokenState,
    });

    await expect(service.verifyEmail('sgv_bad')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('rejects an unknown token', async () => {
    const { service } = makeService();
    await expect(service.verifyEmail('sgv_unknown')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('resendVerification', () => {
  test('unknown email resolves silently without sending', async () => {
    const { service, mailer } = makeService();
    await expect(service.resendVerification('ghost@example.com')).resolves.toBeUndefined();
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
  });

  test('already-verified user gets no email', async () => {
    const { service, prisma, mailer } = makeService();
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, emailVerifiedAt: new Date() });
    await service.resendVerification(baseUser.email);
    expect(mailer.sendVerificationEmail).not.toHaveBeenCalled();
  });

  test('unverified user gets a link whose token matches the stored hash', async () => {
    const { service, prisma, mailer } = makeService();
    prisma.user.findUnique.mockResolvedValue(baseUser);

    await service.resendVerification(baseUser.email);

    expect(mailer.sendVerificationEmail).toHaveBeenCalledTimes(1);
    const [, , link] = mailer.sendVerificationEmail.mock.calls[0] as unknown as [string, string, string];
    const token = new URL(link).searchParams.get('token')!;
    expect(token).toMatch(/^sgv_[0-9a-f]{64}$/);
    const [stored] = prisma.emailVerificationToken.create.mock.calls[0] as unknown as [
      { data: { tokenHash: string; expiresAt: Date } },
    ];
    expect(stored.data.tokenHash).toBe(sha256(token));
    expect(stored.data.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('register with REQUIRE_EMAIL_VERIFICATION=true', () => {
  test('existing email gets the same pending response as a fresh signup', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(baseUser);

    const result = await service.register({
      email: baseUser.email,
      password: 'a-long-password',
      name: 'Ada',
    });

    expect(result).toEqual({ requiresVerification: true, email: baseUser.email });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('fresh signup returns pending (no tokens) and sends the email', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    const { service, prisma, mailer } = makeService();

    const result = await service.register({
      email: baseUser.email,
      password: 'a-long-password',
      name: 'Ada',
    });

    expect(result).toEqual({ requiresVerification: true, email: baseUser.email });
    expect(mailer.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  test('login is blocked until the email is verified', async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    const { service, prisma } = makeService();
    const { hashPassword } = await import('../src/auth/password');
    prisma.user.findUnique.mockResolvedValue({
      ...baseUser,
      passwordHash: hashPassword('a-long-password'),
    });

    await expect(service.login(baseUser.email, 'a-long-password')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
