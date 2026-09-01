import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getActor, can } from '@/server/auth/actor';
import { exchangeCode, googleOAuthConfig } from '@/server/modules/email/oauth';
import { GmailProvider } from '@/server/modules/email/providers/gmail';
import { connectMailbox } from '@/server/modules/email/commands';

export const dynamic = 'force-dynamic';

const STATE_COOKIE = 'mdx_oauth_state';
const VERIFIER_COOKIE = 'mdx_oauth_verifier';

/**
 * Completes the authorization.
 *
 * Every failure below redirects to the mailbox page with a short reason code.
 * None of them puts a provider response, a code or a token into the URL, a log
 * line or an error message — a redirect target is the least private place in
 * the system.
 */
export async function GET(request: NextRequest) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/settings/mailbox?error=${reason}`, site));

  const actor = await getActor();
  if (!actor) return NextResponse.redirect(new URL('/sign-in', site));
  if (!can(actor, 'mailbox.manage')) return NextResponse.redirect(new URL('/settings', site));
  if (!actor.businessUnitId) return fail('no_business_unit');

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const verifier = jar.get(VERIFIER_COOKIE)?.value;

  // Consumed on first use, success or failure, so a replayed callback cannot
  // reuse them.
  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);

  const params = request.nextUrl.searchParams;
  if (params.get('error')) return fail('declined');

  const code = params.get('code');
  const state = params.get('state');

  if (!code || !state || !expectedState || !verifier) return fail('missing_state');
  // CSRF: without this, a third party can hand the user a callback URL that
  // connects THEIR mailbox to this account.
  if (state !== expectedState) return fail('state_mismatch');

  try {
    const config = googleOAuthConfig();
    const tokens = await exchangeCode(config, code, verifier);

    // Ask the provider who the token belongs to rather than trusting a form
    // field: the address is the mailbox's identity and its uniqueness key.
    const profile = await new GmailProvider(tokens.accessToken).verify();

    await connectMailbox(
      {
        businessUnitId: actor.businessUnitId,
        provider: 'gmail',
        address: profile.address,
        displayName: profile.displayName,
        tokens,
      },
      actor,
    );

    return NextResponse.redirect(new URL('/settings/mailbox?connected=1', site));
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        action: 'mailbox.oauth_callback',
        // The message only; provider payloads and tokens never reach a log.
        detail: error instanceof Error ? error.message : 'unknown error',
      }),
    );
    return fail('exchange_failed');
  }
}
