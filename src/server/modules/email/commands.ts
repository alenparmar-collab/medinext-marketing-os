import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { withServiceRole } from '@/server/privileged/service-client';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import { decryptToken, encryptToken, redactSecrets, TOKEN_KEY_VERSION } from './crypto';
import { googleOAuthConfig, refreshAccessToken, type TokenSet } from './oauth';
import { GmailProvider } from './providers/gmail';
import { FixtureProvider, fixtureMessage } from './providers/fixture';
import type { EmailProvider } from './providers/types';
import { syncMailbox, type SyncResult } from './ingestion';

/**
 * Mailbox lifecycle and synchronisation.
 *
 * Everything here that touches a token goes through `withServiceRole`, which
 * writes an audit row naming the reason before it runs. Credentials live in
 * `private.mailbox_credentials`, which `authenticated` cannot address at all,
 * so there is no path from a request to a token except this one.
 */

export interface ConnectMailboxInput {
  businessUnitId: string;
  provider: 'gmail';
  address: string;
  displayName: string | null;
  tokens: TokenSet;
}

/**
 * Records a newly authorised mailbox and stores its tokens encrypted.
 *
 * Re-authorising an existing mailbox updates it in place rather than creating a
 * second row: the messages already ingested belong to that mailbox, and a
 * duplicate would orphan them.
 */
export async function connectMailbox(
  input: ConnectMailboxInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  if (!input.tokens.refreshToken) {
    throw new AppError(
      'PRECONDITION_FAILED',
      'Google did not return a refresh token. Remove this application from the account’s ' +
        'third-party access and authorise again.',
    );
  }

  const supabase = await createServerSupabase();

  const { data: mailbox, error } = await supabase
    .from('mailboxes')
    .upsert(
      {
        business_unit_id: input.businessUnitId,
        provider: input.provider,
        mailbox_address: input.address,
        display_name: input.displayName,
        status: 'connected',
        connected_by: actor.userId,
        connected_at: new Date().toISOString(),
        disconnected_at: null,
        last_sync_error: null,
      },
      { onConflict: 'business_unit_id,provider,mailbox_address' },
    )
    .select('id')
    .single();

  if (error || !mailbox) throw error ?? new AppError('INTERNAL', 'The mailbox was not saved.');

  // The tokens are encrypted HERE, in the application, so the plaintext never
  // reaches Postgres and a database dump yields nothing usable.
  const refreshCiphertext = encryptToken(input.tokens.refreshToken);
  const accessCiphertext = encryptToken(input.tokens.accessToken);

  await withServiceRole(
    actor,
    `Store encrypted OAuth tokens for mailbox ${input.address}`,
    async (db) => {
      const { error: credentialError } = await db
        .schema('private')
        .from('mailbox_credentials')
        .upsert({
          mailbox_id: mailbox.id,
          refresh_token_encrypted: refreshCiphertext,
          access_token_encrypted: accessCiphertext,
          access_token_expires_at: input.tokens.expiresAt,
          granted_scopes: input.tokens.scopes,
          key_version: TOKEN_KEY_VERSION,
          updated_at: new Date().toISOString(),
        });
      if (credentialError) throw credentialError;
    },
  );

  return { id: mailbox.id };
}

/**
 * Disconnects a mailbox.
 *
 * The credentials are destroyed; the evidence is not. Messages already
 * ingested stay exactly where they are — they are a record of what happened,
 * and disconnecting a mailbox is not a reason to lose it.
 */
export async function disconnectMailbox(
  mailboxId: string,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('mailboxes')
    .update({
      status: 'disconnected',
      disconnected_at: new Date().toISOString(),
      sync_cursor: null,
      last_sync_error: null,
    })
    .eq('id', mailboxId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Mailbox not found, or not permitted.');

  await withServiceRole(actor, `Delete stored OAuth tokens for mailbox ${mailboxId}`, async (db) => {
    const { error: deleteError } = await db
      .schema('private')
      .from('mailbox_credentials')
      .delete()
      .eq('mailbox_id', mailboxId);
    if (deleteError) throw deleteError;
  });

  return { id: data.id };
}

/**
 * Builds a live provider client for a mailbox, refreshing the access token if
 * it has expired.
 *
 * Only reachable under the service role, because that is the only context that
 * can read the credentials at all.
 */
async function providerForMailbox(
  db: Parameters<Parameters<typeof withServiceRole>[2]>[0],
  mailboxId: string,
  provider: string,
): Promise<EmailProvider> {
  if (process.env.MAILBOX_PROVIDER === 'fixture') {
    // Development and demo only. Selected by an environment variable rather
    // than by a code path, so production cannot reach it by accident.
    return new FixtureProvider([fixtureMessage({ providerMessageId: 'fixture-1' })]);
  }

  if (provider !== 'gmail') {
    throw new AppError('PRECONDITION_FAILED', `No adapter is implemented for ${provider} yet.`);
  }

  const { data: credentials, error } = await db
    .schema('private')
    .from('mailbox_credentials')
    .select('refresh_token_encrypted, access_token_encrypted, access_token_expires_at')
    .eq('mailbox_id', mailboxId)
    .maybeSingle();

  if (error) throw error;
  if (!credentials) {
    throw new AppError('PRECONDITION_FAILED', 'This mailbox has no stored authorisation.');
  }

  const expiresAt = credentials.access_token_expires_at
    ? Date.parse(credentials.access_token_expires_at)
    : 0;
  // A minute of headroom: a token that expires mid-request is a failed sync.
  const stillValid = expiresAt - 60_000 > Date.now();

  if (stillValid && credentials.access_token_encrypted) {
    return new GmailProvider(decryptToken(credentials.access_token_encrypted));
  }

  const config = googleOAuthConfig();
  const refreshed = await refreshAccessToken(
    config,
    decryptToken(credentials.refresh_token_encrypted),
  );

  await db
    .schema('private')
    .from('mailbox_credentials')
    .update({
      access_token_encrypted: encryptToken(refreshed.accessToken),
      access_token_expires_at: refreshed.expiresAt,
      // Google usually omits the refresh token on a refresh. Keeping the
      // existing one rather than writing null is what stops the connection
      // dying on the second refresh.
      ...(refreshed.refreshToken
        ? { refresh_token_encrypted: encryptToken(refreshed.refreshToken) }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('mailbox_id', mailboxId);

  return new GmailProvider(refreshed.accessToken);
}

/**
 * Runs one synchronisation.
 *
 * Deliberately on-demand: there is no polling loop anywhere in this build.
 * Provider APIs are metered, a loop that runs whether or not anything changed
 * is the fastest way to be rate-limited, and a scheduled job or a push
 * subscription is a deployment decision rather than something to hard-code.
 */
export async function runMailboxSync(
  mailboxId: string,
  actor: ActorContext,
  trigger: 'initial' | 'manual' | 'scheduled' = 'manual',
): Promise<SyncResult> {
  const supabase = await createServerSupabase();

  // RLS decides whether this caller may see the mailbox at all. Doing it here,
  // before the service role is involved, is what stops the privileged path
  // being usable as an access bypass.
  const { data: mailbox, error } = await supabase
    .from('mailboxes')
    .select('id, provider, status, mailbox_address')
    .eq('id', mailboxId)
    .maybeSingle();

  if (error) throw error;
  if (!mailbox) throw new AppError('NOT_FOUND', 'Mailbox not found, or not permitted.');
  if (mailbox.status === 'disconnected') {
    throw new AppError('PRECONDITION_FAILED', 'Connect the mailbox before synchronising it.');
  }

  return withServiceRole(
    actor,
    `Synchronise mailbox ${mailbox.mailbox_address} (${trigger})`,
    async (db) => {
      let provider: EmailProvider;
      try {
        provider = await providerForMailbox(db, mailbox.id, mailbox.provider);
      } catch (cause) {
        // A credential failure is a sync failure and belongs in the mailbox's
        // own record, not only in a toast the user will navigate away from.
        const message = redactSecrets(
          cause instanceof Error ? cause.message : 'Could not authorise with the provider.',
        ).slice(0, 500);

        await db
          .from('mailboxes')
          .update({
            status: 'revoked',
            last_sync_attempted_at: new Date().toISOString(),
            last_sync_error: message,
          })
          .eq('id', mailbox.id);

        throw new AppError('PRECONDITION_FAILED', message);
      }

      return syncMailbox(db, provider, {
        mailboxId: mailbox.id,
        trigger,
        startedBy: actor.userId,
        preserveRaw: true,
      });
    },
  );
}
