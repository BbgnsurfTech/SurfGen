import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { UnauthorizedError } from '@surfgen/core';

/** Normalized identity claims extracted from a verified Google ID token. */
export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Server-side OAuth 2.0 authorization-code flow against Google.
 *
 * The browser never loads Google JS — it is redirected to the consent page
 * and returns to /v1/auth/google/callback, where the code is exchanged and
 * the ID token verified against Google's JWKS (via google-auth-library).
 * The feature is off unless GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set.
 */
@Injectable()
export class GoogleOAuthService {
  isConfigured(): boolean {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  private redirectUri(): string {
    const apiUrl = process.env.PUBLIC_API_URL ?? 'http://localhost:4000';
    return process.env.GOOGLE_REDIRECT_URI ?? `${apiUrl}/v1/auth/google/callback`;
  }

  authorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      // Always show the chooser — a machine with one signed-in Google account
      // would otherwise silently log into it, which surprises shared devices.
      prompt: 'select_account',
    });
    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<GoogleProfile> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const client = new OAuth2Client(clientId, process.env.GOOGLE_CLIENT_SECRET, this.redirectUri());
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) throw new UnauthorizedError('Google sign-in failed');

    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new UnauthorizedError('Google sign-in failed');

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? payload.email.split('@')[0] ?? 'New user',
      avatarUrl: payload.picture ?? null,
    };
  }
}
