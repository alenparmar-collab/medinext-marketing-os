import { describe, expect, it } from 'vitest';
import {
  buildSnippet,
  decodeBase64Url,
  extractAddress,
  extractDisplayName,
  normalizeSubject,
  parseAddressList,
  parseDate,
  parseReferences,
  pickHeaders,
} from '@/server/modules/email/providers/normalize';
import { normalizeGmailMessage } from '@/server/modules/email/providers/gmail';
import { encryptToken, decryptToken, redactSecrets } from '@/server/modules/email/crypto';

/**
 * Normalisation is where malformed real-world mail either becomes clean
 * evidence or becomes a crash. These are the cases that actually arrive.
 */
describe('address parsing', () => {
  it('keeps a quoted display name containing a comma in one piece', () => {
    // The obvious implementation — split(',') — turns this into two broken
    // addresses, one of them `"Ferreira`.
    const addresses = parseAddressList('"Ferreira, Ana" <ana@example.invalid>, bob@example.invalid');
    expect(addresses).toEqual(['ana@example.invalid', 'bob@example.invalid']);
  });

  it('handles an angle-bracketed address with a comma in the display name only', () => {
    expect(parseAddressList('"Smith, John (HR)" <j.smith@example.invalid>')).toEqual([
      'j.smith@example.invalid',
    ]);
  });

  it('lowercases, because addresses compare case-insensitively', () => {
    expect(extractAddress('Rachel.Okonkwo@Example.INVALID')).toBe('rachel.okonkwo@example.invalid');
  });

  it('strips a mailto: prefix', () => {
    expect(extractAddress('mailto:a@b.invalid')).toBe('a@b.invalid');
  });

  it('returns null rather than a broken address', () => {
    expect(extractAddress('not an address')).toBeNull();
    expect(extractAddress('')).toBeNull();
    expect(extractAddress(null)).toBeNull();
  });

  it('drops unparseable entries from a list instead of failing the message', () => {
    expect(parseAddressList('good@example.invalid, nonsense, other@example.invalid')).toEqual([
      'good@example.invalid',
      'other@example.invalid',
    ]);
  });

  it('extracts a display name only when there is one', () => {
    expect(extractDisplayName('"Ana Ferreira" <ana@example.invalid>')).toBe('Ana Ferreira');
    expect(extractDisplayName('ana@example.invalid')).toBeNull();
  });
});

describe('threading headers', () => {
  it('parses a wrapped References header', () => {
    expect(parseReferences('<a@x.invalid>\r\n <b@x.invalid>\t<c@x.invalid>')).toEqual([
      '<a@x.invalid>',
      '<b@x.invalid>',
      '<c@x.invalid>',
    ]);
  });

  it('ignores anything that is not a message id', () => {
    expect(parseReferences('garbage <a@x.invalid>')).toEqual(['<a@x.invalid>']);
  });

  it('strips reply and forward prefixes for display', () => {
    expect(normalizeSubject('Re: Fwd: RE: Application')).toBe('Application');
    expect(normalizeSubject('Re[2]: Application')).toBe('Application');
    expect(normalizeSubject('AW: Bewerbung')).toBe('Bewerbung');
  });

  it('leaves an ordinary subject alone', () => {
    expect(normalizeSubject('Interview on Thursday')).toBe('Interview on Thursday');
  });
});

describe('dates', () => {
  it('parses a normal Date header', () => {
    expect(parseDate('Thu, 21 Aug 2026 14:00:00 +0100')).toBe('2026-08-21T13:00:00.000Z');
  });

  it('returns null for a malformed header rather than throwing', () => {
    // sent_at is nullable precisely so a sender who lies about the date cannot
    // fail the ingestion of an otherwise good message.
    expect(parseDate('yesterday afternoon')).toBeNull();
  });

  it('rejects an implausible year as a parsing artefact', () => {
    expect(parseDate('1 Jan 1200 00:00:00 +0000')).toBeNull();
  });
});

describe('bodies', () => {
  it('decodes base64url', () => {
    const encoded = Buffer.from('Hello — world').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('Hello — world');
  });

  it('returns null for undecodable data instead of throwing', () => {
    expect(decodeBase64Url(null)).toBeNull();
  });

  it('builds a collapsed snippet', () => {
    expect(buildSnippet('Line one.\n\n  Line two.')).toBe('Line one. Line two.');
  });

  it('truncates long snippets', () => {
    const snippet = buildSnippet('x'.repeat(500), 50);
    expect(snippet).toHaveLength(50);
    expect(snippet?.endsWith('…')).toBe(true);
  });

  it('keeps only the retained headers', () => {
    const picked = pickHeaders({
      'delivered-to': 'marketing@medinext.invalid',
      subject: 'should not be here',
      'x-secret-internal': 'nor this',
    });
    expect(picked).toEqual({ 'delivered-to': 'marketing@medinext.invalid' });
  });
});

/**
 * The Gmail payload shape, as the API actually returns it: headers as an array
 * of {name,value}, bodies base64url-encoded, parts nested arbitrarily deep.
 */
describe('Gmail normalisation', () => {
  const encode = (text: string) => Buffer.from(text).toString('base64url');

  const message = {
    id: 'msg-1',
    threadId: 'thread-1',
    snippet: 'Provider snippet',
    internalDate: '1787923200000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: '"Okonkwo, Rachel" <r.okonkwo@northwind.invalid>' },
        { name: 'To', value: 'marketing@medinext.invalid' },
        { name: 'Cc', value: '"Team, Hiring" <hiring@northwind.invalid>, ops@northwind.invalid' },
        { name: 'Subject', value: 'Re: Application' },
        { name: 'Date', value: 'Thu, 21 Aug 2026 14:00:00 +0100' },
        { name: 'Message-ID', value: '<northwind-2@northwind.invalid>' },
        { name: 'In-Reply-To', value: '<northwind-1@northwind.invalid>' },
        { name: 'References', value: '<northwind-1@northwind.invalid>' },
        { name: 'Delivered-To', value: 'marketing@medinext.invalid' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: encode('The plain body.') } },
            { mimeType: 'text/html', body: { data: encode('<p>The html body.</p>') } },
          ],
        },
        {
          mimeType: 'application/pdf',
          filename: 'joining-details.pdf',
          body: { attachmentId: 'att-1', size: 84213 },
        },
      ],
    },
  };

  const normalized = normalizeGmailMessage(message);

  it('finds bodies nested inside multipart/alternative', () => {
    expect(normalized.bodyText).toBe('The plain body.');
    expect(normalized.bodyHtml).toBe('<p>The html body.</p>');
  });

  it('separates attachments from body parts', () => {
    expect(normalized.attachments).toEqual([
      {
        providerAttachmentId: 'att-1',
        fileName: 'joining-details.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 84213,
      },
    ]);
  });

  it('reads headers case-insensitively', () => {
    expect(normalized.fromAddress).toBe('r.okonkwo@northwind.invalid');
    expect(normalized.fromName).toBe('Okonkwo, Rachel');
    expect(normalized.internetMessageId).toBe('<northwind-2@northwind.invalid>');
  });

  it('parses a Cc list containing a quoted comma', () => {
    expect(normalized.ccAddresses).toEqual(['hiring@northwind.invalid', 'ops@northwind.invalid']);
  });

  it('keeps received (the provider clock) separate from sent (the sender claim)', () => {
    expect(normalized.receivedAt).toBe(new Date(1787923200000).toISOString());
    expect(normalized.sentAt).toBe('2026-08-21T13:00:00.000Z');
  });

  it('carries the provider ids that make it idempotent', () => {
    expect(normalized.providerMessageId).toBe('msg-1');
    expect(normalized.providerThreadId).toBe('thread-1');
  });

  it('survives a message with no headers and no parts at all', () => {
    // Real mailboxes contain these. Ingestion must record that something
    // arrived rather than throwing.
    const bare = normalizeGmailMessage({ id: 'bare', threadId: 't', payload: {} });
    expect(bare.fromAddress).toBe('unknown@invalid');
    expect(bare.subject).toBeNull();
    expect(bare.attachments).toEqual([]);
    expect(bare.receivedAt).toBeTruthy();
  });
});

/**
 * Tokens. The key never reaches the database, so an attacker with the data has
 * ciphertext and nothing else.
 */
describe('token encryption', () => {
  const KEY = Buffer.alloc(32, 7).toString('base64');

  it('round-trips a token', () => {
    process.env.MAILBOX_TOKEN_KEY = KEY;
    const token = '1//0abcdefghijklmnop';
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it('produces different ciphertext each time, so equal tokens are not detectable', () => {
    process.env.MAILBOX_TOKEN_KEY = KEY;
    expect(encryptToken('same')).not.toBe(encryptToken('same'));
  });

  it('never contains the plaintext', () => {
    process.env.MAILBOX_TOKEN_KEY = KEY;
    expect(encryptToken('ya29.super-secret')).not.toContain('super-secret');
  });

  it('refuses a tampered ciphertext rather than returning rubbish', () => {
    process.env.MAILBOX_TOKEN_KEY = KEY;
    const encrypted = encryptToken('token');
    const parts = encrypted.split('.');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('evil').toString('base64')].join('.');
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('refuses to operate without a key', () => {
    delete process.env.MAILBOX_TOKEN_KEY;
    expect(() => encryptToken('token')).toThrow(/MAILBOX_TOKEN_KEY/);
    process.env.MAILBOX_TOKEN_KEY = KEY;
  });

  it('refuses a key of the wrong length', () => {
    process.env.MAILBOX_TOKEN_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptToken('token')).toThrow(/32 bytes/);
    process.env.MAILBOX_TOKEN_KEY = KEY;
  });
});

describe('secret redaction', () => {
  it('removes bearer tokens from a diagnostic string', () => {
    expect(redactSecrets('failed with Authorization: Bearer ya29.abcdefghijklmnop')).not.toContain(
      'ya29',
    );
  });

  it('removes a refresh token', () => {
    const redacted = redactSecrets('refresh_token=1//0abcdefghijklmnop');
    expect(redacted).not.toContain('0abcdefghijklmnop');
    expect(redacted).toMatch(/\[redacted/);
  });

  it('removes a client secret', () => {
    expect(redactSecrets('client_secret: GOCSPX-abcdef')).not.toContain('GOCSPX-abcdef');
  });

  it('leaves ordinary diagnostics readable', () => {
    const message = 'The mailbox provider was temporarily unavailable.';
    expect(redactSecrets(message)).toBe(message);
  });
});
