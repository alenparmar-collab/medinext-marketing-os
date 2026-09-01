import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type {
  EmailProcessingStatus,
  EmailProvider,
  EmailSyncStatus,
  EmailSyncTrigger,
  MailboxStatus,
} from '@/config/statuses';

/**
 * Reads run through the user-scoped client, so RLS decides what comes back.
 * There is no role branching here: a caller without `email.view` gets zero
 * rows from the database, not a filtered list from this file.
 */

export interface MailboxSummary {
  id: string;
  provider: EmailProvider;
  address: string;
  displayName: string | null;
  status: MailboxStatus;
  /** The two are separate on purpose — see the mailbox table's comment. */
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptedAt: string | null;
  lastSyncError: string | null;
  connectedAt: string | null;
  messageCount: number;
  threadCount: number;
}

export interface SyncRunSummary {
  id: string;
  status: EmailSyncStatus;
  trigger: EmailSyncTrigger;
  startedAt: string;
  finishedAt: string | null;
  messagesSeen: number;
  messagesCreated: number;
  messagesUpdated: number;
  errorMessage: string | null;
  startedByName: string | null;
}

const MAILBOX_COLUMNS =
  'id, provider, mailbox_address, display_name, status, last_successful_sync_at, last_sync_attempted_at, last_sync_error, connected_at, business_unit_id';

export async function listMailboxes(): Promise<MailboxSummary[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('mailboxes')
    .select(MAILBOX_COLUMNS)
    .order('mailbox_address');

  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Counts come from the messages and threads themselves — RLS-filtered, so a
  // caller without email.view sees a mailbox with a count of zero rather than
  // a count of somebody else's correspondence.
  const ids = rows.map((r) => r.id);
  const [messages, threads] = await Promise.all([
    supabase.from('email_messages').select('mailbox_id').in('mailbox_id', ids),
    supabase.from('email_threads').select('mailbox_id').in('mailbox_id', ids),
  ]);

  const messageCounts = new Map<string, number>();
  for (const row of messages.data ?? []) {
    messageCounts.set(row.mailbox_id, (messageCounts.get(row.mailbox_id) ?? 0) + 1);
  }
  const threadCounts = new Map<string, number>();
  for (const row of threads.data ?? []) {
    threadCounts.set(row.mailbox_id, (threadCounts.get(row.mailbox_id) ?? 0) + 1);
  }

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    address: row.mailbox_address,
    displayName: row.display_name,
    status: row.status,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastSyncAttemptedAt: row.last_sync_attempted_at,
    lastSyncError: row.last_sync_error,
    connectedAt: row.connected_at,
    messageCount: messageCounts.get(row.id) ?? 0,
    threadCount: threadCounts.get(row.id) ?? 0,
  }));
}

export async function listSyncRuns(mailboxId: string, limit = 10): Promise<SyncRunSummary[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('mailbox_sync_runs')
    .select(
      'id, status, trigger_kind, started_at, finished_at, messages_seen, messages_created, messages_updated, error_message, started_by',
    )
    .eq('mailbox_id', mailboxId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  const rows = data ?? [];

  const actorIds = [...new Set(rows.map((r) => r.started_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', actorIds);
    for (const u of users ?? []) names.set(u.id, u.full_name);
  }

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    trigger: row.trigger_kind,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    messagesSeen: row.messages_seen,
    messagesCreated: row.messages_created,
    messagesUpdated: row.messages_updated,
    errorMessage: row.error_message,
    startedByName: row.started_by ? (names.get(row.started_by) ?? null) : null,
  }));
}

export interface EmailListItem {
  id: string;
  threadId: string;
  fromAddress: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
  processingStatus: EmailProcessingStatus;
  hasAttachments: boolean;
  attachmentCount: number;
  threadMessageCount: number;
}

export interface EmailListPage {
  items: EmailListItem[];
  /** Total matching rows, so pagination can say "page 2 of 7" honestly. */
  total: number;
  page: number;
  pageSize: number;
}

export interface EmailListParams {
  search?: string | undefined;
  status?: EmailProcessingStatus | undefined;
  mailboxId?: string | undefined;
  threadId?: string | undefined;
  hasAttachments?: boolean | undefined;
  page?: number;
  pageSize?: number;
}

// A single literal. Concatenation widens the select string to `string` and the
// inferred row type collapses with it. Note the absence of body_text and
// body_html: a list of fifty emails must not carry fifty bodies.
const LIST_COLUMNS =
  'id, thread_id, from_address, from_name, subject, snippet, received_at, processing_status, has_attachments, attachment_count';

export async function listEmails(params: EmailListParams): Promise<EmailListPage> {
  const supabase = await createServerSupabase();

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));
  const from = (page - 1) * pageSize;

  let query = supabase.from('email_messages').select(LIST_COLUMNS, { count: 'exact' });

  if (params.mailboxId) query = query.eq('mailbox_id', params.mailboxId);
  if (params.threadId) query = query.eq('thread_id', params.threadId);
  if (params.status) query = query.eq('processing_status', params.status);
  if (params.hasAttachments) query = query.eq('has_attachments', true);

  if (params.search) {
    // PostgREST's `or` filter is comma-delimited and parenthesis-aware, so
    // those characters are stripped from the term rather than escaped. The
    // value still travels as a parameter — this is about not corrupting the
    // filter grammar, not about SQL injection, which PostgREST prevents.
    const term = params.search.replace(/[(),*]/g, ' ').trim();
    if (term) {
      query = query.or(
        `subject.ilike.%${term}%,from_address.ilike.%${term}%,snippet.ilike.%${term}%,body_text.ilike.%${term}%`,
      );
    }
  }

  const { data, error, count } = await query
    .order('received_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw error;

  const rows = data ?? [];
  const threadIds = [...new Set(rows.map((r) => r.thread_id))];
  const threadCounts = new Map<string, number>();
  if (threadIds.length > 0) {
    const { data: threads } = await supabase
      .from('email_threads')
      .select('id, message_count')
      .in('id', threadIds);
    for (const t of threads ?? []) threadCounts.set(t.id, t.message_count);
  }

  return {
    items: rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      fromAddress: row.from_address,
      fromName: row.from_name,
      subject: row.subject,
      snippet: row.snippet,
      receivedAt: row.received_at,
      processingStatus: row.processing_status,
      hasAttachments: row.has_attachments,
      attachmentCount: row.attachment_count,
      threadMessageCount: threadCounts.get(row.thread_id) ?? 1,
    })),
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

export interface EmailAttachmentSummary {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  isDownloaded: boolean;
}

export interface EmailDetail extends EmailListItem {
  mailboxId: string;
  mailboxAddress: string;
  providerMessageId: string;
  internetMessageId: string | null;
  inReplyTo: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string | null;
  headers: Record<string, string>;
  hasRawEvidence: boolean;
  processingError: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  threadSubject: string | null;
  attachments: EmailAttachmentSummary[];
}

const DETAIL_COLUMNS =
  'id, thread_id, mailbox_id, from_address, from_name, subject, snippet, received_at, processing_status, has_attachments, attachment_count, provider_message_id, internet_message_id, in_reply_to, to_addresses, cc_addresses, bcc_addresses, body_text, body_html, sent_at, headers, raw_storage_path, processing_error, first_seen_at, last_seen_at';

export async function getEmail(messageId: string): Promise<EmailDetail> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('email_messages')
    .select(DETAIL_COLUMNS)
    .eq('id', messageId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Email not found.');

  const [threadResult, mailboxResult, attachmentsResult] = await Promise.all([
    supabase
      .from('email_threads')
      .select('normalized_subject, message_count')
      .eq('id', data.thread_id)
      .maybeSingle(),
    supabase.from('mailboxes').select('mailbox_address').eq('id', data.mailbox_id).maybeSingle(),
    supabase
      .from('email_attachments')
      .select('id, file_name, mime_type, size_bytes, storage_path')
      .eq('message_id', messageId)
      .order('file_name'),
  ]);

  return {
    id: data.id,
    threadId: data.thread_id,
    mailboxId: data.mailbox_id,
    // The mailbox may be invisible to this caller (mailbox.view is a separate
    // capability from email.view), and that is not an error.
    mailboxAddress: mailboxResult.data?.mailbox_address ?? 'Not visible to you',
    providerMessageId: data.provider_message_id,
    internetMessageId: data.internet_message_id,
    inReplyTo: data.in_reply_to,
    fromAddress: data.from_address,
    fromName: data.from_name,
    toAddresses: data.to_addresses,
    ccAddresses: data.cc_addresses,
    bccAddresses: data.bcc_addresses,
    subject: data.subject,
    snippet: data.snippet,
    bodyText: data.body_text,
    bodyHtml: data.body_html,
    sentAt: data.sent_at,
    receivedAt: data.received_at,
    headers: data.headers,
    // Whether an original was preserved, not where it lives: the storage path
    // is operational detail with no business meaning in a page.
    hasRawEvidence: data.raw_storage_path !== null,
    processingStatus: data.processing_status,
    processingError: data.processing_error,
    hasAttachments: data.has_attachments,
    attachmentCount: data.attachment_count,
    firstSeenAt: data.first_seen_at,
    lastSeenAt: data.last_seen_at,
    threadSubject: threadResult.data?.normalized_subject ?? null,
    threadMessageCount: threadResult.data?.message_count ?? 1,
    attachments: (attachmentsResult.data ?? []).map((a) => ({
      id: a.id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      isDownloaded: a.storage_path !== null,
    })),
  };
}

export interface EmailThreadDetail {
  id: string;
  subject: string | null;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messages: EmailListItem[];
}

export async function getThread(threadId: string): Promise<EmailThreadDetail> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('email_threads')
    .select('id, normalized_subject, message_count, first_message_at, last_message_at')
    .eq('id', threadId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Thread not found.');

  // Oldest first: a thread is read as a conversation, not as an inbox.
  const messages = await listEmails({ threadId, pageSize: 100 });

  return {
    id: data.id,
    subject: data.normalized_subject,
    messageCount: data.message_count,
    firstMessageAt: data.first_message_at,
    lastMessageAt: data.last_message_at,
    messages: [...messages.items].reverse(),
  };
}
