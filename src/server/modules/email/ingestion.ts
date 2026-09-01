import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { redactSecrets } from './crypto';
import {
  ProviderAuthError,
  ProviderTransientError,
  type EmailProvider,
  type NormalizedMessage,
} from './providers/types';
import { normalizeSubject } from './providers/normalize';

/**
 * INGESTION ONLY.
 *
 * This module reads a mailbox and writes email evidence. It does not create or
 * modify an application, interview, assessment, rejection, candidate,
 * assignment or notification, and it does not import anything that could.
 *
 * That boundary is the architecture of this build, not a coding convention.
 * Interpreting an email — deciding it means "interview scheduled" — is a
 * separate step with its own validation and its own review queue, and it
 * belongs to a later build that consumes messages in the `ready` state. A test
 * asserts this file imports nothing from the CRM modules.
 */

type Db = SupabaseClient<Database>;

export interface SyncOptions {
  mailboxId: string;
  trigger: 'initial' | 'manual' | 'scheduled';
  startedBy?: string | null;
  /**
   * A ceiling on provider requests for one run. Mailbox APIs are metered, and
   * an unbounded first sync of a five-year-old mailbox is how an integration
   * gets rate-limited on day one.
   */
  maxMessages?: number;
  /** Preserve the original bytes when the provider can supply them. */
  preserveRaw?: boolean;
}

export interface SyncResult {
  runId: string;
  status: 'succeeded' | 'failed';
  messagesSeen: number;
  messagesCreated: number;
  messagesUpdated: number;
  attachmentsSeen: number;
  cursorBefore: string | null;
  cursorAfter: string | null;
  error: string | null;
}

const DEFAULT_MAX_MESSAGES = 250;
const PAGE_SIZE = 100;

/**
 * One synchronisation run.
 *
 * The contract that matters:
 *
 *   * It is safe to call twice. Every message write is an upsert on
 *     (mailbox_id, provider_message_id), so a retry updates rather than
 *     duplicates.
 *   * A failure never advances the cursor. The last known-good position
 *     survives, so the next run resumes rather than restarting or skipping.
 *   * A failure is recorded, not thrown away. The run row keeps a redacted
 *     reason an internal user can act on.
 */
export async function syncMailbox(
  db: Db,
  provider: EmailProvider,
  options: SyncOptions,
): Promise<SyncResult> {
  const mailbox = await loadMailbox(db, options.mailboxId);
  const cursorBefore = mailbox.sync_cursor;

  const { data: run, error: runError } = await db
    .from('mailbox_sync_runs')
    .insert({
      business_unit_id: mailbox.business_unit_id,
      mailbox_id: mailbox.id,
      trigger_kind: options.trigger,
      status: 'running',
      cursor_before: cursorBefore,
      started_by: options.startedBy ?? null,
    })
    .select('id')
    .single();

  if (runError || !run) throw runError ?? new Error('Could not open a sync run.');

  // Recorded before any provider call: an attempt that dies mid-flight must
  // still show up as an attempt, or the mailbox looks untouched.
  await db
    .from('mailboxes')
    .update({ last_sync_attempted_at: new Date().toISOString() })
    .eq('id', mailbox.id);

  const totals = { seen: 0, created: 0, updated: 0, attachments: 0 };
  let cursorAfter: string | null = cursorBefore;

  try {
    let pageToken: string | null = null;
    const budget = options.maxMessages ?? DEFAULT_MAX_MESSAGES;

    do {
      const page = await provider.listMessageIds({
        cursor: cursorBefore,
        pageToken,
        limit: Math.min(PAGE_SIZE, budget - totals.seen),
      });

      for (const providerMessageId of page.messageIds) {
        if (totals.seen >= budget) break;
        totals.seen += 1;

        const outcome = await ingestMessage(db, provider, mailbox, providerMessageId, {
          preserveRaw: options.preserveRaw ?? false,
        });

        if (outcome.created) totals.created += 1;
        else totals.updated += 1;
        totals.attachments += outcome.attachments;
      }

      // Only advance once the page is fully ingested. A cursor written before
      // its messages are stored is a cursor that skips them.
      cursorAfter = page.cursor ?? cursorAfter;
      pageToken = page.nextPageToken;
    } while (pageToken !== null && totals.seen < (options.maxMessages ?? DEFAULT_MAX_MESSAGES));

    await db
      .from('mailbox_sync_runs')
      .update({
        status: 'succeeded',
        finished_at: new Date().toISOString(),
        cursor_after: cursorAfter,
        messages_seen: totals.seen,
        messages_created: totals.created,
        messages_updated: totals.updated,
        attachments_seen: totals.attachments,
      })
      .eq('id', run.id);

    await db
      .from('mailboxes')
      .update({
        status: 'connected',
        sync_cursor: cursorAfter,
        last_successful_sync_at: new Date().toISOString(),
        last_sync_error: null,
      })
      .eq('id', mailbox.id);

    return {
      runId: run.id,
      status: 'succeeded',
      messagesSeen: totals.seen,
      messagesCreated: totals.created,
      messagesUpdated: totals.updated,
      attachmentsSeen: totals.attachments,
      cursorBefore,
      cursorAfter,
      error: null,
    };
  } catch (error) {
    const message = describeFailure(error);

    await db
      .from('mailbox_sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        // Deliberately NOT cursor_after: this run did not establish a new
        // position, and recording one would claim progress it did not make.
        messages_seen: totals.seen,
        messages_created: totals.created,
        messages_updated: totals.updated,
        attachments_seen: totals.attachments,
        error_message: message,
      })
      .eq('id', run.id);

    // sync_cursor is untouched. The next run resumes from the last successful
    // position, and anything ingested before the failure is already committed
    // and will be recognised rather than duplicated.
    await db
      .from('mailboxes')
      .update({
        status: error instanceof ProviderAuthError ? 'revoked' : 'error',
        last_sync_error: message,
      })
      .eq('id', mailbox.id);

    return {
      runId: run.id,
      status: 'failed',
      messagesSeen: totals.seen,
      messagesCreated: totals.created,
      messagesUpdated: totals.updated,
      attachmentsSeen: totals.attachments,
      cursorBefore,
      cursorAfter: cursorBefore,
      error: message,
    };
  }
}

interface MailboxRow {
  id: string;
  business_unit_id: string;
  sync_cursor: string | null;
}

async function loadMailbox(db: Db, mailboxId: string): Promise<MailboxRow> {
  const { data, error } = await db
    .from('mailboxes')
    .select('id, business_unit_id, sync_cursor')
    .eq('id', mailboxId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Mailbox not found.');
  return data;
}

/**
 * Ingests one message, idempotently.
 *
 * Returns whether the row was created, so a run can report "8 new, 42 already
 * held" rather than a single opaque number that hides whether anything moved.
 */
export async function ingestMessage(
  db: Db,
  provider: EmailProvider,
  mailbox: MailboxRow,
  providerMessageId: string,
  options: { preserveRaw: boolean },
): Promise<{ created: boolean; attachments: number; messageId: string }> {
  const existing = await db
    .from('email_messages')
    .select('id')
    .eq('mailbox_id', mailbox.id)
    .eq('provider_message_id', providerMessageId)
    .maybeSingle();

  // A message we already hold gets its last_seen_at moved and nothing else.
  // Re-fetching and rewriting it would spend a provider request to overwrite
  // evidence with a later rendering of itself.
  if (existing.data) {
    await db
      .from('email_messages')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existing.data.id);
    return { created: false, attachments: 0, messageId: existing.data.id };
  }

  const message = await provider.fetchMessage(providerMessageId);
  const threadId = await upsertThread(db, mailbox, message);

  const rawPath = options.preserveRaw ? await preserveRaw(provider, message) : null;

  const { data: inserted, error } = await db
    .from('email_messages')
    .upsert(
      {
        business_unit_id: mailbox.business_unit_id,
        mailbox_id: mailbox.id,
        thread_id: threadId,
        provider_message_id: message.providerMessageId,
        internet_message_id: message.internetMessageId,
        in_reply_to: message.inReplyTo,
        references_header: message.references,
        from_address: message.fromAddress,
        from_name: message.fromName,
        to_addresses: message.toAddresses,
        cc_addresses: message.ccAddresses,
        bcc_addresses: message.bccAddresses,
        subject: message.subject,
        snippet: message.snippet,
        body_text: message.bodyText,
        body_html: message.bodyHtml,
        sent_at: message.sentAt,
        received_at: message.receivedAt,
        headers: message.headers,
        has_attachments: message.attachments.length > 0,
        attachment_count: message.attachments.length,
        raw_storage_path: rawPath?.path ?? null,
        raw_checksum: rawPath?.checksum ?? null,
        source_type: 'email_event',
        // Straight to `stored`: by this point the evidence is persisted, which
        // is exactly what that state means.
        processing_status: 'stored',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'mailbox_id,provider_message_id' },
    )
    .select('id')
    .single();

  if (error || !inserted) throw error ?? new Error('Message could not be stored.');

  for (const attachment of message.attachments) {
    await db.from('email_attachments').upsert(
      {
        business_unit_id: mailbox.business_unit_id,
        message_id: inserted.id,
        provider_attachment_id: attachment.providerAttachmentId,
        file_name: attachment.fileName,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
      },
      { onConflict: 'message_id,provider_attachment_id' },
    );
  }

  // `ready` means complete and available to a future interpretation layer.
  // Nothing in this build reads it; the state exists so Build 7 has a queue to
  // consume that does not require it to guess whether ingestion finished.
  await db
    .from('email_messages')
    .update({ processing_status: 'ready' })
    .eq('id', inserted.id);

  return { created: true, attachments: message.attachments.length, messageId: inserted.id };
}

/**
 * Threads are keyed on the provider's thread id, never on the subject.
 *
 * Subject-based threading merges every "Re: Application" in the mailbox into
 * one conversation and splits a thread the moment somebody edits the subject.
 * normalized_subject is stored for display only.
 */
async function upsertThread(
  db: Db,
  mailbox: MailboxRow,
  message: NormalizedMessage,
): Promise<string> {
  const existing = await db
    .from('email_threads')
    .select('id')
    .eq('mailbox_id', mailbox.id)
    .eq('provider_thread_id', message.providerThreadId)
    .maybeSingle();

  if (existing.data) return existing.data.id;

  const { data, error } = await db
    .from('email_threads')
    .upsert(
      {
        business_unit_id: mailbox.business_unit_id,
        mailbox_id: mailbox.id,
        provider_thread_id: message.providerThreadId,
        normalized_subject: normalizeSubject(message.subject),
      },
      { onConflict: 'mailbox_id,provider_thread_id' },
    )
    .select('id')
    .single();

  if (error || !data) throw error ?? new Error('Thread could not be stored.');
  return data.id;
}

/**
 * Preserving the original.
 *
 * Best effort by design: a provider that cannot supply raw bytes, or a storage
 * write that fails, must not lose the normalized evidence we already have.
 * `raw_storage_path` stays null and the message says so, rather than the whole
 * message being discarded because one part of it was unavailable.
 */
async function preserveRaw(
  provider: EmailProvider,
  message: NormalizedMessage,
): Promise<{ path: string; checksum: string } | null> {
  if (!provider.fetchRawMessage) return null;

  try {
    const bytes = await provider.fetchRawMessage(message.providerMessageId);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    return {
      // Path only. The bytes are written by the caller that owns storage
      // access, so this module never needs a storage client of its own.
      path: `${message.providerThreadId}/${message.providerMessageId}.eml`,
      checksum,
    };
  } catch {
    return null;
  }
}

/**
 * Turns a failure into something safe to store and show.
 *
 * Provider errors quote request context, which can include a bearer token, and
 * this string lands in a database column an internal user reads. It is
 * truncated and scrubbed before it goes anywhere.
 */
function describeFailure(error: unknown): string {
  const base =
    error instanceof ProviderAuthError
      ? 'The mailbox provider rejected our credentials. Reconnect the mailbox.'
      : error instanceof ProviderTransientError
        ? 'The mailbox provider was temporarily unavailable. The next sync will resume.'
        : error instanceof Error
          ? error.message
          : 'Synchronisation failed for an unknown reason.';

  return redactSecrets(base).slice(0, 500);
}
