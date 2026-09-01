import type {
  EmailProvider,
  ListOptions,
  MessagePage,
  NormalizedMessage,
} from './types';

/**
 * A provider backed by an in-memory list of messages.
 *
 * Its purpose is to make the ingestion service testable without a network, a
 * mailbox, or credentials — which means the interesting cases (a redelivered
 * message, a page boundary, a provider that fails halfway through a run) can
 * be exercised deterministically rather than hoped for.
 *
 * It is also what `MAILBOX_PROVIDER=fixture` selects in development, so the
 * explorer can be worked on without connecting anybody's real mailbox.
 */
export class FixtureProvider implements EmailProvider {
  readonly kind = 'gmail' as const;

  /** Requests served, so a test can assert the caller did not over-fetch. */
  fetchCount = 0;
  listCount = 0;

  constructor(
    private readonly messages: NormalizedMessage[],
    private readonly options: {
      address?: string;
      pageSize?: number;
      /** Throws on the fetch of this message id, to simulate a mid-run failure. */
      failOnMessageId?: string;
      failure?: Error;
    } = {},
  ) {}

  async verify(): Promise<{ address: string; displayName: string | null }> {
    return {
      address: this.options.address ?? 'marketing@example.invalid',
      displayName: 'Marketing mailbox',
    };
  }

  async listMessageIds(options: ListOptions): Promise<MessagePage> {
    this.listCount += 1;

    const pageSize = this.options.pageSize ?? this.messages.length;
    const start = options.pageToken ? Number(options.pageToken) : 0;
    const slice = this.messages.slice(start, start + pageSize);
    const next = start + pageSize;

    return {
      messageIds: slice.map((m) => m.providerMessageId),
      nextPageToken: next < this.messages.length ? String(next) : null,
      // A monotonic stand-in for a provider history id.
      cursor: `cursor-${this.messages.length}`,
    };
  }

  async fetchMessage(providerMessageId: string): Promise<NormalizedMessage> {
    this.fetchCount += 1;

    if (this.options.failOnMessageId === providerMessageId) {
      throw this.options.failure ?? new Error('fixture provider failure');
    }

    const message = this.messages.find((m) => m.providerMessageId === providerMessageId);
    if (!message) throw new Error(`fixture has no message ${providerMessageId}`);
    return message;
  }
}

/** Builds a normalized message with sensible defaults, for tests and seeds. */
export function fixtureMessage(
  overrides: Partial<NormalizedMessage> & Pick<NormalizedMessage, 'providerMessageId'>,
): NormalizedMessage {
  return {
    providerThreadId: `thread-${overrides.providerMessageId}`,
    internetMessageId: `<${overrides.providerMessageId}@example.invalid>`,
    inReplyTo: null,
    references: [],
    fromAddress: 'recruiter@example.invalid',
    fromName: 'Example Recruiter',
    toAddresses: ['marketing@example.invalid'],
    ccAddresses: [],
    bccAddresses: [],
    subject: 'Example subject',
    snippet: null,
    bodyText: 'Example body.',
    bodyHtml: null,
    sentAt: '2026-08-01T09:00:00.000Z',
    receivedAt: '2026-08-01T09:00:05.000Z',
    headers: {},
    attachments: [],
    ...overrides,
  };
}
