import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UnauthorizedError } from '@surfgen/core';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie'; // fastify type augmentation: request.cookies / reply.setCookie
import { PrismaService } from '../common/prisma.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService, type AuthTokens } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { Principal, Public, type AuthenticatedPrincipal } from './guards';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  name: z.string().min(1).max(120),
  /** Honeypot — hidden in the UI; bots that fill it get a fake success. */
  website: z.string().optional(),
});

const VerifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
const ResendSchema = z.object({ email: z.string().email() });

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** Browsers rely on the httpOnly cookie; CLIs/API clients pass the body field. */
const RefreshSchema = z.object({ refreshToken: z.string().min(1).optional() });

const GoogleCallbackSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

const REFRESH_COOKIE = 'surfgen_rt';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600; // mirror REFRESH_TOKEN_TTL_DAYS

const OAUTH_STATE_COOKIE = 'surfgen_oauth_state';
const OAUTH_STATE_MAX_AGE_SECONDS = 600;

const publicWebUrl = (): string => process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000';

/**
 * SameSite=Strict + Path=/v1/auth: the cookie only travels to the auth
 * endpoints and never on cross-site requests, so cookie-based refresh is not
 * CSRF-able into anything beyond minting tokens the attacker cannot read.
 * Everything else stays Authorization-header (in-memory access token).
 */
function refreshCookieOptions() {
  // COOKIE_SECURE (when set, non-empty) wins over the NODE_ENV default —
  // "false" enables plain-http trials on a raw IP, where browsers reject
  // Secure cookies; anything served over https should leave it unset/true.
  const explicit = process.env.COOKIE_SECURE;
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: explicit ? explicit === 'true' : process.env.NODE_ENV === 'production',
    path: '/v1/auth',
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Unlike the refresh cookie, the state cookie must be SameSite=Lax: the
 * OAuth callback arrives as a top-level navigation from accounts.google.com,
 * and a Strict cookie would not accompany that request.
 */
function oauthStateCookieOptions() {
  const explicit = process.env.COOKIE_SECURE;
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: explicit ? explicit === 'true' : process.env.NODE_ENV === 'production',
    path: '/v1/auth',
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  };
}

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'The signed-in principal’s profile' })
  async me(@Principal() principal: AuthenticatedPrincipal) {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: { id: true, email: true, name: true, avatarUrl: true, isSuperAdmin: true },
    });
    if (!user) throw new UnauthorizedError('Invalid or expired access token');
    return user;
  }

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
    if (body.website) {
      // Honeypot tripped — answer like a verification-pending signup and do
      // nothing, so bots cannot tell they were caught.
      return { requiresVerification: true, email: body.email };
    }
    const result = await this.authService.register({
      email: body.email,
      password: body.password,
      name: body.name,
    });
    return result.requiresVerification ? result : this.withSessionCookie(reply, result);
  }

  @Public()
  @HttpCode(200)
  @Post('verify-email')
  @ApiOperation({ summary: 'Confirm an email address (single-use token) and sign in' })
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) body: z.infer<typeof VerifyEmailSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.withSessionCookie(reply, await this.authService.verifyEmail(body.token));
  }

  @Public()
  @HttpCode(202)
  @Post('resend-verification')
  @ApiOperation({ summary: 'Re-send the verification email (never reveals account existence)' })
  async resendVerification(
    @Body(new ZodValidationPipe(ResendSchema)) body: z.infer<typeof ResendSchema>,
  ) {
    await this.authService.resendVerification(body.email);
    return { sent: true };
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
  @Get('providers')
  @ApiOperation({ summary: 'Which sign-in methods this deployment offers' })
  providers() {
    return { password: true, google: this.googleOAuth.isConfigured() };
  }

  @Public()
  @Get('google')
  @ApiOperation({ summary: 'Begin the Google OAuth sign-in flow (full-page redirect)' })
  googleStart(@Res() reply: FastifyReply) {
    if (!this.googleOAuth.isConfigured()) {
      return reply.redirect(`${publicWebUrl()}/login?sso_error=unconfigured`, 302);
    }
    const state = randomBytes(16).toString('hex');
    reply.setCookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions());
    return reply.redirect(this.googleOAuth.authorizationUrl(state), 302);
  }

  @Public()
  @Get('google/callback')
  @ApiOperation({ summary: 'Google OAuth redirect target — establishes the browser session' })
  async googleCallback(
    @Query(new ZodValidationPipe(GoogleCallbackSchema)) query: z.infer<typeof GoogleCallbackSchema>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const back = (suffix: string) => reply.redirect(`${publicWebUrl()}/login?${suffix}`, 302);
    const expectedState = request.cookies[OAUTH_STATE_COOKIE];
    reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/v1/auth' });

    if (query.error) return back('sso_error=denied');
    if (!query.code || !query.state || !expectedState || query.state !== expectedState) {
      return back('sso_error=state');
    }
    try {
      const profile = await this.googleOAuth.exchangeCode(query.code);
      const tokens = await this.authService.loginWithGoogle(profile);
      this.withSessionCookie(reply, tokens);
      return back('sso=ok');
    } catch {
      // Provider/linking failures all collapse to one generic code — the URL
      // must never carry attacker-visible detail about accounts.
      return back('sso_error=failed');
    }
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
