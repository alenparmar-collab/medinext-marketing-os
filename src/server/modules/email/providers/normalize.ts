/**
 * Provider-independent parsing helpers.
 *
 * These live outside any provider because they are about email, not about
 * Gmail — and because they are the fiddly, wrong-in-production parts that
 * deserve their own tests rather than being buried in an API client.
 */

/**
 * Splits an address-list header into addresses.
 *
 * Real headers look like:
 *   "Ferreira, Ana" <ana@example.com>, bob@example.com
 * The comma inside the quoted display name is not a separator. Splitting on
 * commas — the obvious implementation — turns that into two broken addresses,
 * one of which is `"Ferreira`.
 */
export function parseAddressList(header: string | null | undefined): string[] {
  if (!header) return [];

  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;

  for (const char of header) {
    if (char === '"' && !inAngle) {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === '<' && !inQuotes) inAngle = true;
    if (char === '>' && !inQuotes) inAngle = false;

    if (char === ',' && !inQuotes && !inAngle) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);

  return out.map(extractAddress).filter((a): a is string => a !== null);
}

/** `"Ana Ferreira" <ana@example.com>` -> `ana@example.com`. */
export function extractAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const angled = /<([^>]+)>/.exec(trimmed);
  const address = (angled?.[1] ?? trimmed).trim().replace(/^mailto:/i, '');

  // Addresses are compared case-insensitively; storing them lowercased means
  // the database's citext and the application agree.
  return address.includes('@') ? address.toLowerCase() : null;
}

/** The display name, if the header carried one. */
export function extractDisplayName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const angled = trimmed.indexOf('<');
  if (angled <= 0) return null;

  const name = trimmed.slice(0, angled).trim().replace(/^"|"$/g, '').trim();
  return name === '' ? null : name;
}

/**
 * The References header is a space-separated list of message ids, wrapped
 * across lines by mail transfer agents.
 */
export function parseReferences(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(/\s+/)
    .map((r) => r.trim())
    .filter((r) => r.startsWith('<') && r.endsWith('>'));
}

/**
 * Strips reply and forward prefixes so a thread can be labelled sensibly.
 *
 * Used for DISPLAY ONLY. Thread identity comes from the provider's thread id —
 * subjects collide, get edited mid-conversation, and are trivially forged, so
 * grouping by normalized subject would merge unrelated conversations and split
 * related ones.
 */
export function normalizeSubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const stripped = subject
    .replace(/^(\s*(re|fw|fwd|aw|sv|vs|antw)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .trim();
  return stripped === '' ? null : stripped;
}

/**
 * Parses a date header into an ISO string, or null.
 *
 * Malformed Date headers are common, and a message whose sender lied about the
 * date must not fail ingestion — `sent_at` is nullable precisely so this can
 * return null instead of throwing.
 */
export function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;

  // A date far outside plausible range is a parsing artefact, not evidence.
  const year = new Date(parsed).getUTCFullYear();
  if (year < 1990 || year > 2100) return null;

  return new Date(parsed).toISOString();
}

/** Gmail and Graph both base64url-encode part bodies. */
export function decodeBase64Url(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/**
 * A short preview, when the provider does not supply one.
 *
 * Deliberately taken from the plain-text body only. Deriving it from HTML
 * would mean stripping tags here, and a half-written tag stripper in a preview
 * helper is how markup ends up rendered somewhere it should not be.
 */
export function buildSnippet(bodyText: string | null, length = 200): string | null {
  if (!bodyText) return null;
  const collapsed = bodyText.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  return collapsed.length <= length ? collapsed : `${collapsed.slice(0, length - 1)}…`;
}

/** The headers worth keeping. Everything else stays with the raw message. */
export const RETAINED_HEADERS = [
  'delivered-to',
  'return-path',
  'reply-to',
  'list-id',
  'x-mailer',
  'authentication-results',
] as const;

export function pickHeaders(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of RETAINED_HEADERS) {
    const value = all[name];
    if (value) out[name] = value;
  }
  return out;
}
