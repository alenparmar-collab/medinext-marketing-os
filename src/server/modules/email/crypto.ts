import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for provider tokens.
 *
 * The key lives in the environment and never in the database, so a database
 * dump — or a backup, or a support session with read access — yields
 * ciphertext and nothing else. That is the whole point: `private` schema plus
 * no grants keeps tokens away from the API, and this keeps them away from
 * anyone holding a copy of the data.
 *
 * AES-256-GCM rather than CBC: it authenticates as well as encrypts, so a
 * tampered ciphertext fails to decrypt instead of silently producing rubbish
 * that gets sent to Google as a bearer token.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM's standard nonce length.
const KEY_BYTES = 32;

export const TOKEN_KEY_VERSION = 1;

function key(): Buffer {
  const raw = process.env.MAILBOX_TOKEN_KEY;
  if (!raw) {
    throw new Error(
      'MAILBOX_TOKEN_KEY is not configured. Mailbox tokens cannot be stored without it.',
    );
  }

  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `MAILBOX_TOKEN_KEY must decode to ${KEY_BYTES} bytes; got ${decoded.length}.`,
    );
  }
  return decoded;
}

/** Returns `v1.<iv>.<tag>.<ciphertext>`, all base64. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // The version prefix is what makes key rotation possible later without
  // guessing which rows are stale.
  return [
    `v${TOKEN_KEY_VERSION}`,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

export function decryptToken(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 4 || !parts[0]?.startsWith('v')) {
    throw new Error('Stored token is not in the expected envelope format.');
  }

  const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Redacts anything token-shaped from a string bound for a log, an audit row or
 * a UI error.
 *
 * Belt and braces. Nothing in the ingestion path deliberately logs a token,
 * but provider errors quote request context, and "we were careful" is not a
 * control.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(ya29|1\/\/)[A-Za-z0-9._~+/-]{10,}/g, '[redacted-token]')
    .replace(/("?(access|refresh|id)_token"?\s*[:=]\s*)"?[A-Za-z0-9._~+/-]{10,}"?/gi, '$1[redacted]')
    .replace(/\b(client_secret|password)\b\s*[:=]\s*\S+/gi, '$1=[redacted]');
}
