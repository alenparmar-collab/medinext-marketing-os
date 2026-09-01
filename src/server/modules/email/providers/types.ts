/**
 * The provider boundary.
 *
 * Everything above this line speaks in normalized messages. Everything below
 * it speaks Gmail, or Microsoft Graph, or IMAP. Nothing crosses.
 *
 * This is not abstraction for its own sake. Gmail returns a message as a
 * recursive MIME tree with base64url-encoded parts and headers in an array of
 * {name, value} objects; Graph returns a flat object with a completely
 * different shape; IMAP returns bytes. If those shapes leak upward, then the
 * ingestion service, the explorer, the search and every test become
 * Gmail-shaped, and the second provider is a rewrite rather than a file.
 */

/** A message as this product understands it, whatever produced it. */
export interface NormalizedMessage {
  /** The provider's identifier. The idempotency key, with the mailbox. */
  providerMessageId: string;
  providerThreadId: string;
  /** RFC 5322 Message-ID, when the provider exposes it. */
  internetMessageId: string | null;
  inReplyTo: string | null;
  references: string[];

  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];

  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;

  /** When the sender says it was sent. Absent or nonsensical on plenty of mail. */
  sentAt: string | null;
  /** When the mailbox received it. The provider's own timestamp, always present. */
  receivedAt: string;

  /** A small, chosen set — not every header the message carried. */
  headers: Record<string, string>;

  attachments: NormalizedAttachment[];
}

export interface NormalizedAttachment {
  providerAttachmentId: string | null;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
}

/** One page of message identifiers, plus the cursor that follows it. */
export interface MessagePage {
  messageIds: string[];
  /**
   * Opaque. The caller stores it and hands it back; it is never parsed above
   * the provider. Null means there is no further page.
   */
  nextPageToken: string | null;
  /**
   * The position to resume an INCREMENTAL sync from, once this run finishes
   * successfully. Distinct from nextPageToken, which paginates within a run.
   */
  cursor: string | null;
}

export interface ListOptions {
  /** Resume point from the last successful sync. Null means an initial sync. */
  cursor?: string | null;
  pageToken?: string | null;
  /** Provider requests are metered; the caller decides how much to ask for. */
  limit?: number;
}

/**
 * Read-only, on purpose.
 *
 * There is no send, no reply, no label mutation and no delete — not because
 * they are hard, but because a mailbox integration that cannot write cannot
 * cause an incident in somebody's inbox. Build 6 requests read-only scopes to
 * match.
 */
export interface EmailProvider {
  readonly kind: 'gmail' | 'microsoft' | 'imap';

  /** Confirms the credentials work and returns the address they belong to. */
  verify(): Promise<{ address: string; displayName: string | null }>;

  listMessageIds(options: ListOptions): Promise<MessagePage>;

  fetchMessage(providerMessageId: string): Promise<NormalizedMessage>;

  /** Raw RFC 822 bytes, for the preserved original. Optional per provider. */
  fetchRawMessage?(providerMessageId: string): Promise<Uint8Array>;

  fetchAttachment?(
    providerMessageId: string,
    providerAttachmentId: string,
  ): Promise<Uint8Array>;
}

/** Thrown when the provider says our credentials are no longer good. */
export class ProviderAuthError extends Error {
  readonly isAuthError = true;
  constructor(message: string) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

/** Thrown when the provider asks us to slow down or is temporarily unwell. */
export class ProviderTransientError extends Error {
  readonly isTransient = true;
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderTransientError';
  }
}
