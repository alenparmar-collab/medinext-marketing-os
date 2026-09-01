import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { GMAIL_READONLY_SCOPE } from './providers/gmail';

/**
 * Google OAuth, authorization-code flow with PKCE.
 *
 * Three rules this build holds to:
 *
 *   1. The user authorises in Google's own interface. We never see, ask for,
 *      or store a password.
 *   2. Read-only. The single scope requested is gmail.readonly. There is no
 *      send scope, and no code path that could use one.
 *   3. The client secret is an environment variable and never a column.
 *
 * PKCE as well as the secret because the authorization code travels through
 * the user's browser: without a verifier, anyone who intercepts the redirect
 * can exchange the code themselves.
 */
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Only this. Adding a scope here is a decision, not a detail. */
export const REQUIRED_SCOPES = [GMAIL_READONLY_SCOPE] as const;

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleOAuthConfig(): OAuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured before a ' +
        'mailbox can be connected.',
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri: `${siteUrl.replace(/\/$/, '')}/api/mailbox/oauth/callback`,
  };
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function createState(): string {
  return base64Url(randomBytes(24));
}

export function buildAuthorizationUrl(config: OAuthConfig, state: string, challenge: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', REQUIRED_SCOPES.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // A refresh token is only issued with consent + offline, and only reliably
  // on the first authorization. Without it the connection dies in an hour.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
}

export async function exchangeCode(
  config: OAuthConfig,
  code: string,
  verifier: string,
): Promise<TokenSet> {
  return requestTokens(config, {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: config.redirectUri,
  });
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string,
): Promise<TokenSet> {
  const tokens = await requestTokens(config, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  // A refresh response usually omits the refresh token; the caller must keep
  // the one it already holds rather than storing null over it.
  return { ...tokens, refreshToken: tokens.refreshToken ?? null };
}

async function requestTokens(
  config: OAuthConfig,
  params: Record<string, string>,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    ...params,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    // The response body echoes the request, including the client secret, so it
    // is not part of the error.
    throw new Error(`Google rejected the token request (${response.status}).`);
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };

  const granted = (json.scope ?? '').split(' ').filter(Boolean);

  // Google can grant less than was asked for if the user unticks a box. A
  // mailbox connected without read access would fail confusingly on the first
  // sync instead of clearly here.
  for (const required of REQUIRED_SCOPES) {
    if (granted.length > 0 && !granted.includes(required)) {
      throw new Error('The mailbox was not authorised for reading. Grant read access and retry.');
    }
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    scopes: granted.length > 0 ? granted : [...REQUIRED_SCOPES],
  };
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
