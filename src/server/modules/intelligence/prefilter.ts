/**
 * Deterministic filtering, before anything is sent to a paid provider.
 *
 * This is not classification. It answers one narrow question — "is there any
 * point interpreting this?" — using signals that are unambiguous by
 * construction: a message with no body, or one carrying the headers that mail
 * systems put on bulk mail specifically so that automated recipients can
 * recognise it.
 *
 * Deliberately NOT a keyword classifier. "Unsubscribe" appears in the footer
 * of plenty of genuine recruiter mail, and a rule that drops those would lose
 * real evidence silently, which is the worst failure mode available.
 */
export interface PrefilterInput {
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  headers: Record<string, string>;
  fromAddress: string;
}

export interface PrefilterResult {
  /** True when the message should not be sent to the provider at all. */
  skip: boolean;
  /** Recorded on the run, so a skipped message says why it was skipped. */
  reason: string | null;
}

const PROCEED: PrefilterResult = { skip: false, reason: null };

export function prefilter(input: PrefilterInput): PrefilterResult {
  const body = (input.bodyText ?? '').trim();

  // Nothing to read. Sending an empty body costs a request and returns a
  // confident-sounding guess about a subject line.
  if (body === '' && !input.bodyHtml) {
    return { skip: true, reason: 'The message has no readable body.' };
  }

  // RFC 2919 / RFC 2369. A List-Id or List-Unsubscribe header is a bulk sender
  // declaring itself — an assertion by the sending system, not a guess from
  // the wording.
  const headers = Object.fromEntries(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  if (headers['list-id'] || headers['list-unsubscribe']) {
    return { skip: true, reason: 'The sender marked this as bulk or list mail.' };
  }

  // Automatic bounces and out-of-office replies, which name themselves in
  // headers rather than in prose.
  const autoSubmitted = headers['auto-submitted'];
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return { skip: true, reason: 'The message is an automatic reply or bounce.' };
  }
  if (headers['x-autoreply'] || headers['x-autorespond']) {
    return { skip: true, reason: 'The message is an automatic reply.' };
  }

  // Null return-path is how mail systems mark a message that must not be
  // replied to: delivery failures and other machine-generated notices.
  const from = input.fromAddress.toLowerCase();
  if (from.startsWith('mailer-daemon@') || from.startsWith('postmaster@')) {
    return { skip: true, reason: 'The message is a delivery notification.' };
  }

  return PROCEED;
}
