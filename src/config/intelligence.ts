/**
 * Interpretation settings, in one place.
 *
 * The thresholds below decide whether a reading stands on its own or waits for
 * a person. Scattering them through the code would mean the number that gates
 * a candidate proposal and the number shown next to it on screen could drift
 * apart, and nobody would notice until a wrong proposal had been acted on.
 */

/** The prompt and output schema this build speaks. Runs record which one produced them. */
export const PROMPT_VERSION = 'email_intelligence_v1';

/**
 * Operational thresholds — NOT accuracy claims.
 *
 * Nothing here has been validated against labelled data. They are starting
 * points chosen to be cautious: the cost of sending a correct reading to a
 * human is a minute of someone's time, and the cost of accepting a wrong one
 * is a candidate told about an interview that does not exist.
 */
export const CONFIDENCE = {
  /** At or above this, the reading stands without review. */
  high: 0.9,
  /** At or above this but below `high`, a person looks first. */
  review: 0.6,
} as const;

export type ConfidenceBand = 'high' | 'review' | 'low';

export function confidenceBand(value: number | null | undefined): ConfidenceBand {
  if (value === null || value === undefined) return 'low';
  if (value >= CONFIDENCE.high) return 'high';
  if (value >= CONFIDENCE.review) return 'review';
  return 'low';
}

export const CONFIDENCE_BAND_META: Record<
  ConfidenceBand,
  { label: string; tone: 'positive' | 'caution' | 'muted'; description: string }
> = {
  high: {
    label: 'High',
    tone: 'positive',
    description: 'The reading is supported by the message.',
  },
  review: {
    label: 'Needs review',
    tone: 'caution',
    description: 'Plausible, but a person should confirm it.',
  },
  low: {
    label: 'Low',
    tone: 'muted',
    description: 'Not enough support in the message to rely on.',
  },
};

/**
 * How much of a thread goes to the provider.
 *
 * A reply of "Thursday at 3pm works" is meaningless alone, so some context is
 * necessary. The whole mailbox is not: it costs money, it sends unrelated
 * candidates' correspondence to a third party, and it gives an injected
 * instruction more places to hide.
 */
export const CONTEXT = {
  /** Previous messages from the SAME thread, newest first. */
  maxThreadMessages: 4,
  /** Per-message body cap, characters. Enough for a real email, not a thesis. */
  maxBodyCharacters: 6000,
  /** Context messages are trimmed harder than the message being read. */
  maxContextBodyCharacters: 1200,
} as const;

/**
 * Candidate matching weights.
 *
 * Deliberately deterministic and deliberately conservative. The model never
 * chooses a candidate; it reports what it saw, and these rules decide what
 * that is worth.
 */
export const MATCH = {
  /** The message contains a candidate's exact email address. */
  exactEmail: 0.95,
  /** A phone number that normalises to a candidate's. */
  exactPhone: 0.85,
  /** A name match WITH a second, independent signal. */
  nameWithCorroboration: 0.8,
  /**
   * A name and nothing else.
   *
   * Below the review threshold on purpose. Names are not identifiers: two
   * people share one, an email quotes a third party's, and a signature block
   * mentions somebody who is not the subject at all.
   */
  nameAlone: 0.35,
} as const;

export const INTELLIGENCE_MODEL_DEFAULT = 'gpt-4o-mini';
