import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syncMailbox } from '@/server/modules/email/ingestion';
import { FixtureProvider, fixtureMessage } from '@/server/modules/email/providers/fixture';
import { ProviderAuthError, ProviderTransientError } from '@/server/modules/email/providers/types';
import { REQUIRED_SCOPES } from '@/server/modules/email/oauth';
import { FakeDb } from './support/fake-db';

/**
 * The ingestion service, run for real against an in-memory database and the
 * fixture provider.
 *
 * These are the guarantees the build stands on: nothing is ingested twice, a
 * failure does not lose the cursor, and nothing that arrives becomes a CRM
 * record.
 */
const MAILBOX = {
  id: 'mailbox-1',
  business_unit_id: 'unit-1',
  sync_cursor: null as string | null,
};

function newDb(cursor: string | null = null) {
  return new FakeDb({ mailboxes: [{ ...MAILBOX, sync_cursor: cursor }] });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: FakeDb) => db as any;

const THREE_MESSAGES = [
  fixtureMessage({
    providerMessageId: 'm1',
    providerThreadId: 't1',
    subject: 'We have received your application',
  }),
  fixtureMessage({
    providerMessageId: 'm2',
    providerThreadId: 't1',
    subject: 'Re: We have received your application',
  }),
  fixtureMessage({
    providerMessageId: 'm3',
    providerThreadId: 't2',
    subject: 'Technical assessment',
    attachments: [
      {
        providerAttachmentId: 'a1',
        fileName: 'brief.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      },
    ],
  }),
];

describe('a first sync', () => {
  it('ingests every message once and groups them into threads', async () => {
    const db = newDb();
    const result = await syncMailbox(asDb(db), new FixtureProvider(THREE_MESSAGES), {
      mailboxId: 'mailbox-1',
      trigger: 'initial',
    });

    expect(result.status).toBe('succeeded');
    expect(result.messagesSeen).toBe(3);
    expect(result.messagesCreated).toBe(3);
    expect(db.rows('email_messages')).toHaveLength(3);
    // Two provider threads, not three subjects.
    expect(db.rows('email_threads')).toHaveLength(2);
  });

  it('stores attachment metadata and nothing more', async () => {
    const db = newDb();
    await syncMailbox(asDb(db), new FixtureProvider(THREE_MESSAGES), {
      mailboxId: 'mailbox-1',
      trigger: 'initial',
    });

    const attachments = db.rows('email_attachments');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ file_name: 'brief.pdf', mime_type: 'application/pdf' });
    // Metadata only: no bytes were fetched, and the row says so.
    expect(attachments[0]?.storage_path ?? null).toBeNull();
  });

  it('leaves every message ready for a later interpretation layer', async () => {
    const db = newDb();
    await syncMailbox(asDb(db), new FixtureProvider(THREE_MESSAGES), {
      mailboxId: 'mailbox-1',
      trigger: 'initial',
    });

    for (const message of db.rows('email_messages')) {
      expect(message.processing_status).toBe('ready');
      expect(message.source_type).toBe('email_event');
    }
  });

  it('records the run and advances the mailbox cursor', async () => {
    const db = newDb();
    await syncMailbox(asDb(db), new FixtureProvider(THREE_MESSAGES), {
      mailboxId: 'mailbox-1',
      trigger: 'initial',
    });

    const [run] = db.rows('mailbox_sync_runs');
    expect(run).toMatchObject({ status: 'succeeded', messages_created: 3 });

    const [mailbox] = db.rows('mailboxes');
    expect(mailbox?.sync_cursor).toBe('cursor-3');
    expect(mailbox?.last_successful_sync_at).toBeTruthy();
    expect(mailbox?.status).toBe('connected');
  });

  it('walks pages rather than assuming one response holds everything', async () => {
    const db = newDb();
    const provider = new FixtureProvider(THREE_MESSAGES, { pageSize: 1 });

    const result = await syncMailbox(asDb(db), provider, {
      mailboxId: 'mailbox-1',
      trigger: 'initial',
    });

    expect(result.messagesCreated).toBe(3);
    expect(provider.listCount).toBeGreaterThan(1);
  });
});

describe('idempotency', () => {
  it('a second sync creates nothing and duplicates nothing', async () => {
    const db = newDb();
    const provider = new FixtureProvider(THREE_MESSAGES);

    await syncMailbox(asDb(db), provider, { mailboxId: 'mailbox-1', trigger: 'initial' });
    const second = await syncMailbox(asDb(db), provider, {
      mailboxId: 'mailbox-1',
      trigger: 'manual',
    });

    expect(second.messagesCreated).toBe(0);
    expect(second.messagesUpdated).toBe(3);
    expect(db.rows('email_messages')).toHaveLength(3);
  });

  it('a redelivered message moves last_seen_at without rewriting the evidence', async () => {
    const db = newDb();
    const provider = new FixtureProvider(THREE_MESSAGES);

    await syncMailbox(asDb(db), provider, { mailboxId: 'mailbox-1', trigger: 'initial' });
    const before = db.rows('email_messages').map((m) => ({
      id: m.id,
      body: m.body_text,
      firstSeen: m.first_seen_at,
      lastSeen: m.last_seen_at,
    }));

    await new Promise((r) => setTimeout(r, 5));
    await syncMailbox(asDb(db), provider, { mailboxId: 'mailbox-1', trigger: 'manual' });

    const after = db.rows('email_messages');
    for (const original of before) {
      const current = after.find((m) => m.id === original.id);
      expect(current?.body_text).toBe(original.body);
      expect(current?.first_seen_at).toBe(original.firstSeen);
      expect(current?.last_seen_at).not.toBe(original.lastSeen);
    }
  });

  it('does not re-fetch a message it already holds', async () => {
    // Provider APIs are metered. Re-fetching every message on every sync is
    // both wasteful and a way to get rate-limited.
    const db = newDb();
    const provider = new FixtureProvider(THREE_MESSAGES);

    await syncMailbox(asDb(db), provider, { mailboxId: 'mailbox-1', trigger: 'initial' });
    expect(provider.fetchCount).toBe(3);

    await syncMailbox(asDb(db), provider, { mailboxId: 'mailbox-1', trigger: 'manual' });
    expect(provider.fetchCount).toBe(3);
  });

  it('reuses the thread rather than creating a second one', async () => {
    const db = newDb();
    const provider = new FixtureProvider(THREE_MESSAGES);

    await syncMailbox(asDb(db), provider, { mailboxId: 'mailbox-1', trigger: 'initial' });
    await syncMailbox(asDb(db), provider, { mailboxId: 'mailbox-1', trigger: 'manual' });

    expect(db.rows('email_threads')).toHaveLength(2);
  });
});

describe('failure handling', () => {
  it('keeps the previous cursor when a run fails part-way', async () => {
    const db = newDb('cursor-known-good');
    const provider = new FixtureProvider(THREE_MESSAGES, {
      failOnMessageId: 'm2',
      failure: new ProviderTransientError('provider unavailable'),
    });

    const result = await syncMailbox(asDb(db), provider, {
      mailboxId: 'mailbox-1',
      trigger: 'manual',
    });

    expect(result.status).toBe('failed');
    // The last known-good position survives; the next run resumes from it.
    expect(db.rows('mailboxes')[0]?.sync_cursor).toBe('cursor-known-good');
    expect(result.cursorAfter).toBe('cursor-known-good');
  });

  it('records the failure without claiming progress it did not make', async () => {
    const db = newDb('cursor-known-good');
    await syncMailbox(
      asDb(db),
      new FixtureProvider(THREE_MESSAGES, {
        failOnMessageId: 'm1',
        failure: new ProviderTransientError('provider unavailable'),
      }),
      { mailboxId: 'mailbox-1', trigger: 'manual' },
    );

    const [run] = db.rows('mailbox_sync_runs');
    expect(run?.status).toBe('failed');
    expect(run?.cursor_after ?? null).toBeNull();
    expect(run?.error_message).toBeTruthy();
  });

  it('keeps whatever was ingested before the failure', async () => {
    const db = newDb();
    await syncMailbox(
      asDb(db),
      new FixtureProvider(THREE_MESSAGES, {
        failOnMessageId: 'm3',
        failure: new ProviderTransientError('provider unavailable'),
      }),
      { mailboxId: 'mailbox-1', trigger: 'manual' },
    );

    expect(db.rows('email_messages')).toHaveLength(2);
  });

  it('recovers on the next run without duplicating the partial import', async () => {
    const db = newDb();
    await syncMailbox(
      asDb(db),
      new FixtureProvider(THREE_MESSAGES, {
        failOnMessageId: 'm3',
        failure: new ProviderTransientError('provider unavailable'),
      }),
      { mailboxId: 'mailbox-1', trigger: 'manual' },
    );

    const recovery = await syncMailbox(asDb(db), new FixtureProvider(THREE_MESSAGES), {
      mailboxId: 'mailbox-1',
      trigger: 'manual',
    });

    expect(recovery.status).toBe('succeeded');
    expect(recovery.messagesCreated).toBe(1);
    expect(recovery.messagesUpdated).toBe(2);
    expect(db.rows('email_messages')).toHaveLength(3);
  });

  it('marks the mailbox revoked, not merely errored, when credentials are rejected', async () => {
    // The two need different remedies: one is "wait", the other is "reconnect".
    const db = newDb();
    await syncMailbox(
      asDb(db),
      new FixtureProvider(THREE_MESSAGES, {
        failOnMessageId: 'm1',
        failure: new ProviderAuthError('rejected'),
      }),
      { mailboxId: 'mailbox-1', trigger: 'manual' },
    );

    expect(db.rows('mailboxes')[0]?.status).toBe('revoked');
  });

  it('never puts a token into the stored failure reason', async () => {
    const db = newDb();
    await syncMailbox(
      asDb(db),
      new FixtureProvider(THREE_MESSAGES, {
        failOnMessageId: 'm1',
        failure: new Error('request failed: Authorization: Bearer ya29.super-secret-value'),
      }),
      { mailboxId: 'mailbox-1', trigger: 'manual' },
    );

    const [run] = db.rows('mailbox_sync_runs');
    expect(String(run?.error_message)).not.toContain('super-secret-value');
    expect(String(db.rows('mailboxes')[0]?.last_sync_error)).not.toContain('super-secret-value');
  });

  it('records the attempt even when the run fails immediately', async () => {
    const db = newDb();
    await syncMailbox(
      asDb(db),
      new FixtureProvider(THREE_MESSAGES, {
        failOnMessageId: 'm1',
        failure: new Error('boom'),
      }),
      { mailboxId: 'mailbox-1', trigger: 'manual' },
    );

    const [mailbox] = db.rows('mailboxes');
    expect(mailbox?.last_sync_attempted_at).toBeTruthy();
    // …and does not pretend it succeeded.
    expect(mailbox?.last_successful_sync_at ?? null).toBeNull();
  });
});

describe('provider limits', () => {
  it('stops at the message budget rather than walking an entire mailbox', async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      fixtureMessage({ providerMessageId: `bulk-${i}`, providerThreadId: 'bulk' }),
    );
    const db = newDb();

    const result = await syncMailbox(asDb(db), new FixtureProvider(many, { pageSize: 10 }), {
      mailboxId: 'mailbox-1',
      trigger: 'initial',
      maxMessages: 12,
    });

    expect(result.messagesSeen).toBe(12);
    expect(db.rows('email_messages')).toHaveLength(12);
  });
});

/**
 * The architectural boundary, asserted against the source rather than against
 * behaviour — because the guarantee is that the code CANNOT do this, not that
 * it happened not to.
 */
describe('ingestion cannot touch the CRM', () => {
  const emailDir = 'src/server/modules/email';

  function filesUnder(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) out.push(...filesUnder(path));
      else if (path.endsWith('.ts')) out.push(path);
    }
    return out;
  }

  const sources = filesUnder(emailDir).map((path) => ({
    path,
    text: readFileSync(resolve(process.cwd(), path), 'utf8'),
  }));

  it('imports no CRM module', () => {
    const forbidden =
      /@\/server\/modules\/(applications|interviews|assessments|activities|candidates|notifications|review|reports|assignments|notes)/;
    const offenders = sources.filter((f) => forbidden.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('writes to no CRM table', () => {
    const forbidden =
      /from\(\s*['"](applications|interviews|assessments|marketing_activities|candidates|candidate_assignments|notifications|review_items|daily_reports)['"]/;
    const offenders = sources.filter((f) => forbidden.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('contains no classification, extraction or matching', () => {
    // Build 6 stops before candidate matching. A helpfully-named function here
    // would be the first step of the thing this build exists not to do yet.
    const forbidden = /classif|extractEntit|matchCandidate|confidence[_ ]?score|openai|anthropic|huggingface/i;
    const offenders = sources.filter((f) => forbidden.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('requests read-only mailbox access and nothing else', () => {
    expect(REQUIRED_SCOPES).toEqual(['https://www.googleapis.com/auth/gmail.readonly']);
    const scopeText = sources.map((f) => f.text).join('\n');
    expect(scopeText).not.toContain('gmail.send');
    expect(scopeText).not.toContain('gmail.modify');
    expect(scopeText).not.toContain('mail.google.com');
  });

  it('the provider interface offers no way to send', () => {
    const types = sources.find((f) => f.path.endsWith('providers/types.ts'))?.text ?? '';
    for (const operation of ['send(', 'reply(', 'delete(', 'markRead(']) {
      expect(types).not.toContain(operation);
    }
  });
});
