import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConflictError, UnauthorizedError } from '@surfgen/core';
import { PrismaService } from '../common/prisma.service';
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

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(input: { email: string; password: string; name: string }): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictError('An account with this email already exists');

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: hashPassword(input.password),
      },
    });

    // Personal organization so the user can work immediately.
    const slugBase = input.email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '-') ?? 'org';
    await this.prisma.organization.create({
      data: {
        name: `${input.name}'s Workspace`,
        slug: `${slugBase}-${randomBytes(3).toString('hex')}`,
        memberships: { create: { userId: user.id, role: 'owner' } },
      },
    });

    return this.issueTokens(user.id, user.email, user.isSuperAdmin);
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || user.deletedAt) {
      throw new UnauthorizedError('Invalid credentials');
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedError('Invalid credentials');
    }
    return this.issueTokens(user.id, user.email, user.isSuperAdmin);
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
