import { afterEach, describe, expect, test, vi } from 'vitest';
import { UnauthorizedError } from '@surfgen/core';
import { AuthService } from '../src/auth/auth.service';
import { GoogleOAuthService } from '../src/auth/google-oauth.service';

const baseUser = {
  id: 'user_1',
  email: 'ada@example.com',
  name: 'Ada',
  isSuperAdmin: false,
  deletedAt: null,
  emailVerifiedAt: null as Date | null,
  avatarUrl: null as string | null,
};

const googleProfile = {
  sub: 'google-sub-123',
  email: 'ada@example.com',
  emailVerified: true,
  name: 'Ada Lovelace',
  avatarUrl: 'https://lh3.googleusercontent.com/a/photo',
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
    oAuthAccount: {
      findUnique: vi.fn(async () => null as unknown),
      create: vi.fn(async () => ({})),
    },
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
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.PUBLIC_API_URL;
});

describe('loginWithGoogle', () => {
  test('rejects a Google account whose email is not verified', async () => {
    // Arrange
    const { service, prisma } = makeService();

    // Act + Assert
    await expect(
      service.loginWithGoogle({ ...googleProfile, emailVerified: false }),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
  });

  test('signs in an already-linked account without creating anything', async () => {
    // Arrange
    const { service, prisma } = makeService();
    prisma.oAuthAccount.findUnique.mockResolvedValue({
      id: 'oauth_1',
      userId: baseUser.id,
      user: { ...baseUser, emailVerifiedAt: new Date() },
    });

    // Act
    const tokens = await service.loginWithGoogle(googleProfile);

    // Assert
    expect(tokens.accessToken).toBe('signed-jwt');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).toHaveBeenCalled();
  });

  test('rejects a linked account whose user is soft-deleted', async () => {
    // Arrange
    const { service, prisma } = makeService();
    prisma.oAuthAccount.findUnique.mockResolvedValue({
      id: 'oauth_1',
      userId: baseUser.id,
      user: { ...baseUser, deletedAt: new Date() },
    });

    // Act + Assert
    await expect(service.loginWithGoogle(googleProfile)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test('links Google to an existing email account and backfills verification', async () => {
    // Arrange
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(baseUser); // unverified password account

    // Act
    const tokens = await service.loginWithGoogle(googleProfile);

    // Assert
    expect(tokens.accessToken).toBe('signed-jwt');
    expect(prisma.oAuthAccount.create).toHaveBeenCalledWith({
      data: { userId: baseUser.id, provider: 'google', providerUserId: googleProfile.sub },
    });
    // Google verified ownership of the address — the local flag follows.
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseUser.id },
        data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  test('does not overwrite an existing verification date when linking', async () => {
    // Arrange
    const { service, prisma } = makeService();
    const verifiedAt = new Date('2026-01-01');
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, emailVerifiedAt: verifiedAt });

    // Act
    await service.loginWithGoogle(googleProfile);

    // Assert
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailVerifiedAt: verifiedAt }),
      }),
    );
  });

  test('rejects an existing email account that is soft-deleted', async () => {
    // Arrange
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ ...baseUser, deletedAt: new Date() });

    // Act + Assert
    await expect(service.loginWithGoogle(googleProfile)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
  });

  test('creates a verified user, personal workspace, and link for a new email', async () => {
    // Arrange
    const { service, prisma } = makeService();

    // Act
    const tokens = await service.loginWithGoogle(googleProfile);

    // Assert
    expect(tokens.accessToken).toBe('signed-jwt');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: googleProfile.email,
        name: googleProfile.name,
        emailVerifiedAt: expect.any(Date),
        avatarUrl: googleProfile.avatarUrl,
      }),
    });
    expect(prisma.organization.create).toHaveBeenCalled();
    expect(prisma.oAuthAccount.create).toHaveBeenCalledWith({
      data: { userId: baseUser.id, provider: 'google', providerUserId: googleProfile.sub },
    });
  });
});

describe('GoogleOAuthService configuration', () => {
  test('is unconfigured without client credentials', () => {
    // Arrange + Act
    const service = new GoogleOAuthService();

    // Assert
    expect(service.isConfigured()).toBe(false);
  });

  test('builds an authorization URL carrying state, scope, and redirect URI', () => {
    // Arrange
    process.env.GOOGLE_CLIENT_ID = 'client-id-123';
    process.env.GOOGLE_CLIENT_SECRET = 'shh';
    process.env.PUBLIC_API_URL = 'https://api.surfgen.example';
    const service = new GoogleOAuthService();

    // Act
    const url = new URL(service.authorizationUrl('state-abc'));

    // Assert
    expect(service.isConfigured()).toBe(true);
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('client-id-123');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.surfgen.example/v1/auth/google/callback',
    );
    expect(url.searchParams.get('scope')).toContain('email');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  test('an explicit GOOGLE_REDIRECT_URI overrides the derived callback', () => {
    // Arrange
    process.env.GOOGLE_CLIENT_ID = 'client-id-123';
    process.env.GOOGLE_CLIENT_SECRET = 'shh';
    process.env.GOOGLE_REDIRECT_URI = 'https://edge.example/oauth/google';
    const service = new GoogleOAuthService();

    // Act
    const url = new URL(service.authorizationUrl('s'));

    // Assert
    expect(url.searchParams.get('redirect_uri')).toBe('https://edge.example/oauth/google');
  });
});
