import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getActor, can } from '@/server/auth/actor';
import {
  buildAuthorizationUrl,
  createPkcePair,
  createState,
  googleOAuthConfig,
} from '@/server/modules/email/oauth';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'mdx_oauth_state';
const VERIFIER_COOKIE = 'mdx_oauth_verifier';
const TEN_MINUTES = 600;

/**
 * Begins the mailbox authorization.
 *
 * The state and PKCE verifier are held in httpOnly cookies rather than in the
 * URL or in memory: the browser is the only thing that survives the round trip
 * to Google, and a verifier readable by client script defeats the point of
 * having one.
 */
export async function GET() {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.redirect(new URL('/sign-in', process.env.NEXT_PUBLIC_SITE_URL));
  }
  if (!can(actor, 'mailbox.manage')) {
    // Not 403-with-detail: an unauthorised caller learns nothing about whether
    // the feature exists.
    return NextResponse.redirect(new URL('/settings', process.env.NEXT_PUBLIC_SITE_URL));
  }

  let url: string;
  const state = createState();
  const { verifier, challenge } = createPkcePair();

  try {
    url = buildAuthorizationUrl(googleOAuthConfig(), state, challenge);
  } catch {
    return NextResponse.redirect(
      new URL('/settings/mailbox?error=not_configured', process.env.NEXT_PUBLIC_SITE_URL),
    );
  }

  const jar = await cookies();
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/mailbox/oauth',
    maxAge: TEN_MINUTES,
  };
  jar.set(STATE_COOKIE, state, options);
  jar.set(VERIFIER_COOKIE, verifier, options);

  return NextResponse.redirect(url);
}
