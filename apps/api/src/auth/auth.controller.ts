import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UnauthorizedError } from '@surfgen/core';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie'; // fastify type augmentation: request.cookies / reply.setCookie
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService, type AuthTokens } from './auth.service';
import { Public } from './guards';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  name: z.string().min(1).max(120),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Browsers rely on the httpOnly cookie; CLIs/API clients pass the body field. */
const RefreshSchema = z.object({ refreshToken: z.string().min(1).optional() });

const REFRESH_COOKIE = 'surfgen_rt';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600; // mirror REFRESH_TOKEN_TTL_DAYS

/**
 * SameSite=Strict + Path=/v1/auth: the cookie only travels to the auth
 * endpoints and never on cross-site requests, so cookie-based refresh is not
 * CSRF-able into anything beyond minting tokens the attacker cannot read.
 * Everything else stays Authorization-header (in-memory access token).
 */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
    path: '/v1/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  };
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Set the browser session cookie; tokens stay in the body for non-browser clients. */
  private withSessionCookie(reply: FastifyReply, tokens: AuthTokens): AuthTokens {
    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());
    return tokens;
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create an account and personal workspace' })
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withSessionCookie(reply, await this.authService.register(body));
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Exchange credentials for access + refresh tokens' })
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withSessionCookie(reply, await this.authService.login(body.email, body.password));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token (body field or httpOnly cookie)' })
  async refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) body: z.infer<typeof RefreshSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const presented = body.refreshToken ?? request.cookies[REFRESH_COOKIE];
    if (!presented) throw new UnauthorizedError('No refresh token presented');
    return this.withSessionCookie(reply, await this.authService.refresh(presented));
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  @ApiOperation({ summary: 'Revoke a refresh token and clear the session cookie' })
  async logout(
    @Body(new ZodValidationPipe(RefreshSchema)) body: z.infer<typeof RefreshSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const presented = body.refreshToken ?? request.cookies[REFRESH_COOKIE];
    if (presented) await this.authService.logout(presented);
    reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth' });
  }
}
