import { createHash } from 'node:crypto';

/**
 * A deterministic fingerprint of what a proposal would actually DO.
 *
 * The problem it solves: the same email can be read twice. If the second
 * reading says the same thing, acting on it again would create a duplicate. If
 * it says something DIFFERENT — Tuesday instead of Monday — treating it as a
 * duplicate makes the disagreement disappear, which is worse. Idempotency has
 * to be able to tell those two apart, and "the JSON is not byte-identical" is
 * not the test: key order, a re-run timestamp or a provider field would make
 * every re-read look like a change and fill the queue with noise.
 *
 * So the fingerprint is taken over MATERIAL fields only — the ones that change
 * what the CRM record is — canonicalised first and then hashed:
 *
 *   1. pick the fields that decide the record's identity for that event type
 *   2. normalise each (trim, lower-case, drop empties, resolve either shape a
 *      proposal can take)
 *   3. serialise in a fixed key order
 *   4. sha256
 *
 * Two properties follow, and both are tested:
 *   same material proposal      → same fingerprint
 *   materially different proposal → different fingerprint
 *
 * The model never produces this. It is computed on the server from values the
 * server derived, which is what makes it usable as an idempotency key: a
 * fingerprint an untrusted party could influence would let a crafted email
 * either collide with an existing decision or evade one.
 */

/**
 * The fields that make a record what it is, per event type.
 *
 * Deliberately NOT "everything in the proposal". A different `interviewer`
 * name, a reworded summary or a changed confidence does not change what gets
 * written, and raising a conflict for it would train reviewers to click
 * through conflicts.
 */
export const MATERIAL_FIELDS: Record<string, readonly string[]> = {
  application: ['candidate', 'company', 'job_title', 'external_reference', 'application_date'],
  interview: [
    'candidate',
    'company',
    'job_title',
    'when',
    'time_zone',
    'meeting_url',
    'external_reference',
  ],
  assessment: [
    'candidate',
    'company',
    'job_title',
    'assessment_type',
    'due_date',
    'assessment_url',
    'external_reference',
  ],
  rejection: ['candidate', 'company', 'job_title', 'application_id'],
  recruiter_response: ['candidate', 'company', 'job_title'],
};

/**
 * The canonical material view of a proposal.
 *
 * Exported separately from the hash because a reviewer looking at a changed
 * interpretation needs to see WHICH field moved, and a hash cannot tell them.
 */
export function materialView(
  eventType: string,
  proposedData: Record<string, unknown>,
  candidateId: string | null,
): Record<string, string> {
  const source: Record<string, unknown> = {
    ...proposedData,
    candidate: candidateId,
    // An interview proposal takes one of two shapes depending on whether it
    // was complete enough to resolve: an instant, or the parts it was built
    // from. Both describe the same appointment, so both fold to one field —
    // otherwise a proposal that gained a time zone on the second reading would
    // look like a change of subject rather than a change of completeness.
    when:
      norm(proposedData.scheduled_at) ??
      joinParts(proposedData.interview_date, proposedData.interview_time),
  };

  const fields = MATERIAL_FIELDS[eventType] ?? ['candidate', 'company', 'job_title'];
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = norm(source[field]);
    if (value !== null) out[field] = value;
  }
  return out;
}

/**
 * sha256 over the canonical view, with keys emitted in the declared order.
 *
 * `JSON.stringify` of an object would carry insertion order into the hash, so
 * the pairs are built explicitly. No timestamp, no run id, no provider field
 * goes in — the same proposal read again next month fingerprints identically.
 */
export function fingerprintProposal(
  eventType: string,
  proposedData: Record<string, unknown>,
  candidateId: string | null,
): string {
  const view = materialView(eventType, proposedData, candidateId);
  const fields = MATERIAL_FIELDS[eventType] ?? ['candidate', 'company', 'job_title'];
  const canonical = fields
    .filter((field) => field in view)
    .map((field) => `${field}=${view[field]}`)
    .join('\n');

  return createHash('sha256').update(`${eventType}\n${canonical}`, 'utf8').digest('hex');
}

/** The material fields whose values differ between two proposals. */
export function materialDifferences(
  eventType: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  beforeCandidate: string | null,
  afterCandidate: string | null,
): string[] {
  const a = materialView(eventType, before, beforeCandidate);
  const b = materialView(eventType, after, afterCandidate);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => a[key] !== b[key]).sort();
}

/**
 * Trim, drop empties, and lower-case.
 *
 * Case folding is deliberate: "Acme Recruiting" and "ACME RECRUITING" are the
 * same company, and a model that changes its mind about capitalisation has not
 * changed its mind about anything.
 */
function norm(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text.toLowerCase();
}

/** `2026-09-15` + `15:00` → `2026-09-15T15:00`. Either half alone still counts. */
function joinParts(date: unknown, time: unknown): string | null {
  const d = norm(date);
  const t = norm(time);
  if (d === null && t === null) return null;
  return `${d ?? '?'}T${t ?? '?'}`;
}
