import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConflictError, ForbiddenError, UnauthorizedError } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
import type { GoogleProfile } from './google-oauth.service';
import { MailerService } from './mailer.service';
import { hashPassword, verifyPassword } from './password';

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  superAdmin: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 min
const REFRESH_TOKEN_TTL_DAYS = 30;
const VERIFICATION_TOKEN_TTL_HOURS = 24;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Login is gated on a confirmed address only when explicitly enabled. */
const verificationRequired = (): boolean => process.env.REQUIRE_EMAIL_VERIFICATION === 'true';

export type RegisterResult =
  | (AuthTokens & { requiresVerification: false })
  | { requiresVerification: true; email: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mailer: MailerService,
  ) {}

  async register(input: { email: string; password: string; name: string }): Promise<RegisterResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // With verification on, respond exactly as for a fresh signup so the
      // endpoint cannot be used to enumerate accounts. With it off, success
      // vs failure is observable anyway — a clear error serves users better.
      if (verificationRequired()) return { requiresVerification: true, email: input.email };
      throw new ConflictError('An account with this email already exists');
    }

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: hashPassword(input.password),
      },
    });

    await this.createPersonalWorkspace(user.id, user.email, user.name);

    await this.sendVerification(user.id, user.email, user.name);
    if (verificationRequired()) return { requiresVerification: true, email: user.email };
    const tokens = await this.issueTokens(user.id, user.email, user.isSuperAdmin);
    return { ...tokens, requiresVerification: false };
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || user.deletedAt) {
      throw new UnauthorizedError('Invalid credentials');
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedError('Invalid credentials');
    }
    if (verificationRequired() && !user.emailVerifiedAt) {
      throw new ForbiddenError('Email not verified — check your inbox or request a new link');
    }
    return this.issueTokens(user.id, user.email, user.isSuperAdmin);
  }

  /**
   * Sign in (or up) with a verified Google identity.
   *
   * Resolution order: existing google link → existing account with the same
   * email (link + backfill verification, since Google confirmed ownership of
   * the address) → brand-new account with a personal workspace. Google-born
   * accounts have no password; password login stays unavailable until one is
   * set through a future reset flow.
   */
  async loginWithGoogle(profile: GoogleProfile): Promise<AuthTokens> {
    if (!profile.emailVerified) {
      throw new UnauthorizedError('Google account email is not verified');
    }

    const linked = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerUserId: { provider: 'google', providerUserId: profile.sub } },
      include: { user: true },
    });
    if (linked) {
      if (linked.user.deletedAt) throw new UnauthorizedError('Invalid credentials');
      return this.issueTokens(linked.user.id, linked.user.email, linked.user.isSuperAdmin);
    }

    const existing = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (existing) {
      if (existing.deletedAt) throw new UnauthorizedError('Invalid credentials');
      await this.prisma.$transaction([
        this.prisma.oAuthAccount.create({
          data: { userId: existing.id, provider: 'google', providerUserId: profile.sub },
        }),
        this.prisma.user.update({
          where: { id: existing.id },
          data: {
            emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
            avatarUrl: existing.avatarUrl ?? profile.avatarUrl,
          },
        }),
      ]);
      return this.issueTokens(existing.id, existing.email, existing.isSuperAdmin);
    }

    const user = await this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        emailVerifiedAt: new Date(),
      },
    });
    await this.createPersonalWorkspace(user.id, user.email, user.name);
    await this.prisma.oAuthAccount.create({
      data: { userId: user.id, provider: 'google', providerUserId: profile.sub },
    });
    return this.issueTokens(user.id, user.email, user.isSuperAdmin);
  }

  /** Personal organization so the user can work immediately. */
  private async createPersonalWorkspace(userId: string, email: string, name: string): Promise<void> {
    const slugBase = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '-') ?? 'org';
    await this.prisma.organization.create({
      data: {
        name: `${name}'s Workspace`,
        slug: `${slugBase}-${randomBytes(3).toString('hex')}`,
        memberships: { create: { userId, role: 'owner' } },
      },
    });
  }

  /** Single-use, 24h-expiry, sha256-stored verification token → auto-login. */
  async verifyEmail(token: string): Promise<AuthTokens> {
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date() || stored.user.deletedAt) {
      throw new UnauthorizedError('Invalid or expired verification link');
    }
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { emailVerifiedAt: stored.user.emailVerifiedAt ?? new Date() },
      }),
    ]);
    return this.issueTokens(stored.user.id, stored.user.email, stored.user.isSuperAdmin);
  }

  /** Always resolves — response never reveals whether the account exists. */
  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || user.emailVerifiedAt) return;
    await this.sendVerification(user.id, user.email, user.name);
  }

  private async sendVerification(userId: string, email: string, name: string): Promise<void> {
    const token = `sgv_${randomBytes(32).toString('hex')}`;
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 3600 * 1000),
      },
    });
    const webUrl = process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000';
    await this.mailer.sendVerificationEmail(
      email,
      name,
      `${webUrl}/verify-email?token=${token}`,
    );
  }

  /** Rotating refresh tokens: each refresh revokes the presented token. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.user.deletedAt) {
      throw new UnauthorizedError('Invalid refresh token');
    }
    await this.prisma.refreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(stored.user.id, stored.user.email, stored.user.isSuperAdmin);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  /** X-Api-Key authentication → resolves to user + org scope. */
  async verifyApiKey(
    apiKey: string,
  ): Promise<{ userId: string; organizationId: string; scopes: string[] }> {
    const record = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(apiKey) } });
    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt < new Date())) {
      throw new UnauthorizedError('Invalid API key');
    }
    await this.prisma.apiKey.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      userId: record.userId,
      organizationId: record.organizationId,
      scopes: record.scopes,
    };
  }

  private async issueTokens(
    userId: string,
    email: string,
    superAdmin: boolean,
  ): Promise<AuthTokens> {
    const payload: AccessTokenPayload = { sub: userId, email, superAdmin };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    const refreshToken = `sgr_${randomBytes(32).toString('hex')}`;
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshToken), expiresAt },
    });

    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
  }
}
