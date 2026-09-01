import 'server-only';
import {
  ProviderAuthError,
  ProviderTransientError,
  type EmailProvider,
  type ListOptions,
  type MessagePage,
  type NormalizedAttachment,
  type NormalizedMessage,
} from './types';
import {
  buildSnippet,
  decodeBase64Url,
  extractAddress,
  extractDisplayName,
  parseAddressList,
  parseDate,
  parseReferences,
  pickHeaders,
} from './normalize';

/**
 * Gmail, read-only.
 *
 * The only scope requested is gmail.readonly. There is no send scope, no
 * modify scope and no code path that would use one — an integration that
 * cannot write cannot put a message in somebody's inbox by accident.
 *
 * Everything Gmail-shaped stops in this file. The rest of the product sees
 * NormalizedMessage.
 */
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export class GmailProvider implements EmailProvider {
  readonly kind = 'gmail' as const;

  constructor(private readonly accessToken: string) {}

  private async call<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${GMAIL_API}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== '') url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      // Never cache a mailbox read: the Next.js data cache is global, not
      // per-user, and this is the last thing that should be shared.
      cache: 'no-store',
    });

    if (response.ok) return (await response.json()) as T;

    // The distinction matters to the caller: an auth failure must mark the
    // mailbox as needing reconnection, while a transient one must leave the
    // cursor alone and be retried.
    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthError(`Gmail rejected the credentials (${response.status}).`);
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new ProviderTransientError(
        `Gmail is temporarily unavailable (${response.status}).`,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    // The body may quote message content, so it is not part of the message.
    throw new Error(`Gmail request failed with ${response.status}.`);
  }

  async verify(): Promise<{ address: string; displayName: string | null }> {
    const profile = await this.call<{ emailAddress: string }>('/profile');
    return { address: profile.emailAddress.toLowerCase(), displayName: null };
  }

  /**
   * Gmail has two listing modes and they are not interchangeable.
   *
   * `history.list` is the incremental one, and is the only one that will not
   * re-walk the whole mailbox on every sync — but it is valid only for a
   * bounded window, and Gmail returns 404 once a historyId is too old. When
   * that happens the correct response is a full re-list, which is safe because
   * ingestion is idempotent: the messages already held collide on their unique
   * key and are updated rather than duplicated.
   */
  async listMessageIds(options: ListOptions): Promise<MessagePage> {
    const limit = String(options.limit ?? 100);

    if (options.cursor) {
      const incremental = await this.tryIncremental(options, limit);
      if (incremental) return incremental;
      // Cursor too old to be incremental. Falling through to a full list is
      // safe because ingestion is idempotent: everything already held collides
      // on (mailbox_id, provider_message_id) and is updated, not duplicated.
    }

    const list = await this.call<{
      messages?: { id: string }[];
      nextPageToken?: string;
    }>('/messages', {
      maxResults: limit,
      ...(options.pageToken ? { pageToken: options.pageToken } : {}),
    });

    // The cursor for the NEXT incremental sync is the mailbox's current
    // historyId, which only a profile read gives us.
    const profile = await this.call<{ historyId?: string }>('/profile');

    return {
      messageIds: (list.messages ?? []).map((m) => m.id),
      nextPageToken: list.nextPageToken ?? null,
      cursor: profile.historyId ?? null,
    };
  }

  /**
   * Returns null when Gmail says the cursor is no longer usable, which is a
   * routine event rather than a failure: history is kept for a bounded window
   * and a mailbox that has been quiet for long enough falls out of it.
   *
   * Auth and transient errors are rethrown — those must not be papered over
   * with a full re-list that would hammer the API on every retry.
   */
  private async tryIncremental(
    options: ListOptions,
    limit: string,
  ): Promise<MessagePage | null> {
    try {
      const history = await this.call<{
        history?: { messagesAdded?: { message: { id: string } }[] }[];
        nextPageToken?: string;
        historyId?: string;
      }>('/history', {
        startHistoryId: options.cursor as string,
        historyTypes: 'messageAdded',
        maxResults: limit,
        ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      });

      const ids = (history.history ?? []).flatMap((entry) =>
        (entry.messagesAdded ?? []).map((added) => added.message.id),
      );

      return {
        messageIds: [...new Set(ids)],
        nextPageToken: history.nextPageToken ?? null,
        // Hold the old cursor if Gmail did not give a new one, rather than
        // advancing to null and forcing a full re-list next time.
        cursor: history.historyId ?? options.cursor ?? null,
      };
    } catch (error) {
      if (error instanceof ProviderAuthError) throw error;
      if (error instanceof ProviderTransientError) throw error;
      return null;
    }
  }

  async fetchMessage(providerMessageId: string): Promise<NormalizedMessage> {
    const message = await this.call<GmailMessage>(`/messages/${providerMessageId}`, {
      format: 'full',
    });
    return normalizeGmailMessage(message);
  }

  async fetchRawMessage(providerMessageId: string): Promise<Uint8Array> {
    const message = await this.call<{ raw?: string }>(`/messages/${providerMessageId}`, {
      format: 'raw',
    });
    const normalized = (message.raw ?? '').replace(/-/g, '+').replace(/_/g, '/');
    return new Uint8Array(Buffer.from(normalized, 'base64'));
  }

  async fetchAttachment(
    providerMessageId: string,
    providerAttachmentId: string,
  ): Promise<Uint8Array> {
    const attachment = await this.call<{ data?: string }>(
      `/messages/${providerMessageId}/attachments/${providerAttachmentId}`,
    );
    const normalized = (attachment.data ?? '').replace(/-/g, '+').replace(/_/g, '/');
    return new Uint8Array(Buffer.from(normalized, 'base64'));
  }
}

/**
 * Exported for tests, which feed it recorded Gmail payloads.
 *
 * A pure function taking a provider payload and returning a normalized message
 * is the piece worth testing hardest: it is where malformed real-world mail
 * either becomes clean evidence or becomes a crash at 3am.
 */
export function normalizeGmailMessage(message: GmailMessage): NormalizedMessage {
  const headers = flattenHeaders(message.payload);
  const { text, html, attachments } = walkParts(message.payload);

  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();

  return {
    providerMessageId: message.id,
    providerThreadId: message.threadId,
    internetMessageId: headers['message-id'] ?? null,
    inReplyTo: headers['in-reply-to'] ?? null,
    references: parseReferences(headers['references']),

    // A message with no parseable From is still evidence that something
    // arrived, so it gets a marker rather than being rejected.
    fromAddress: extractAddress(headers['from']) ?? 'unknown@invalid',
    fromName: extractDisplayName(headers['from']),
    toAddresses: parseAddressList(headers['to']),
    ccAddresses: parseAddressList(headers['cc']),
    bccAddresses: parseAddressList(headers['bcc']),

    subject: headers['subject'] ?? null,
    snippet: message.snippet ?? buildSnippet(text),
    bodyText: text,
    bodyHtml: html,

    sentAt: parseDate(headers['date']),
    receivedAt,

    headers: pickHeaders(headers),
    attachments,
  };
}

function flattenHeaders(part: GmailPart | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of part?.headers ?? []) {
    // Header names are case-insensitive; lowercasing once here means no lookup
    // anywhere else has to guess the casing Gmail used.
    out[header.name.toLowerCase()] = header.value;
  }
  return out;
}

/**
 * Walks the MIME tree.
 *
 * Gmail nests parts arbitrarily deep (multipart/mixed wrapping
 * multipart/alternative wrapping the actual text), so the bodies are found by
 * recursion rather than by looking at `payload.parts[0]` and hoping.
 */
function walkParts(root: GmailPart | undefined): {
  text: string | null;
  html: string | null;
  attachments: NormalizedAttachment[];
} {
  let text: string | null = null;
  let html: string | null = null;
  const attachments: NormalizedAttachment[] = [];

  const visit = (part: GmailPart | undefined): void => {
    if (!part) return;

    const isAttachment = Boolean(part.filename && part.filename.length > 0);
    if (isAttachment) {
      attachments.push({
        providerAttachmentId: part.body?.attachmentId ?? null,
        fileName: part.filename as string,
        mimeType: part.mimeType ?? null,
        sizeBytes: typeof part.body?.size === 'number' ? part.body.size : null,
      });
      return;
    }

    // First body of each type wins: later parts in a multipart/alternative are
    // usually the richer rendering of the same content, not new content.
    if (part.mimeType === 'text/plain' && text === null) {
      text = decodeBase64Url(part.body?.data);
    } else if (part.mimeType === 'text/html' && html === null) {
      html = decodeBase64Url(part.body?.data);
    }

    for (const child of part.parts ?? []) visit(child);
  };

  visit(root);
  return { text, html, attachments };
}
