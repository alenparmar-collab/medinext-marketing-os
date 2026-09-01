/**
 * What may be written without a person looking, and why not.
 *
 * The starting position is conservative on purpose. Every rule below can be
 * loosened once there is evidence about how the model actually performs on
 * this mailbox; none of them can be loosened by the model itself.
 */

export const DECISION_OUTCOMES = [
  'auto_approve',
  'review_required',
  'ignore',
  'rejected',
] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export const DECISION_OUTCOME_META: Record<
  DecisionOutcome,
  { label: string; description: string }
> = {
  auto_approve: {
    label: 'Approved automatically',
    description: 'Complete, unambiguous, and within the rules for writing without review.',
  },
  review_required: {
    label: 'Needs review',
    description: 'A person decides. Nothing has been written.',
  },
  ignore: {
    label: 'Not actionable',
    description: 'Nothing in this email calls for a record.',
  },
  rejected: {
    label: 'Refused',
    description: 'The proposal cannot be acted on as it stands.',
  },
};

/**
 * Structured reasons, because they drive behaviour: the queue filters on them
 * and the priority is derived from them. A free-text explanation accompanies
 * them; it never replaces them.
 */
export const DECISION_REASON_CODES = [
  'low_candidate_confidence',
  'ambiguous_candidate',
  'no_candidate_match',
  'missing_date',
  'missing_time',
  'missing_timezone',
  'missing_required_field',
  'duplicate_detected',
  'conflict_detected',
  'status_transition_not_allowed',
  'insufficient_evidence',
  'unsupported_event',
  'third_party_sender',
  'conflicting_candidate_information',
  'actor_lacks_permission',
  'stale_event',
  'interpretation_changed',
  'other',
] as const;
export type DecisionReasonCode = (typeof DECISION_REASON_CODES)[number];

/**
 * One sentence each, written for the person in the queue rather than for a
 * developer. "Why am I seeing this" has to be answerable without opening the
 * code.
 */
export const DECISION_REASON_META: Record<
  DecisionReasonCode,
  { label: string; priority: 'low' | 'normal' | 'high' }
> = {
  // High: someone could be told the wrong thing, or a record could be damaged.
  ambiguous_candidate: {
    label: 'More than one candidate fits the identifiers in this email.',
    priority: 'high',
  },
  conflict_detected: {
    label: 'This contradicts something already recorded.',
    priority: 'high',
  },
  // The email was processed before and the latest reading disagrees with what
  // was done. Always high: something already on file may be wrong, and the
  // longer that stands the more people act on it.
  interpretation_changed: {
    label: 'A later reading of this email disagrees with the action already taken.',
    priority: 'high',
  },
  conflicting_candidate_information: {
    label: 'Details in the email do not match what is on file for this candidate.',
    priority: 'high',
  },
  status_transition_not_allowed: {
    label: 'The change this implies is not permitted from the current status.',
    priority: 'high',
  },
  third_party_sender: {
    label: 'The sender does not appear to be the employer named in the message.',
    priority: 'high',
  },

  // Normal: incomplete, so acting would mean inventing something.
  low_candidate_confidence: {
    label: 'The candidate could not be identified confidently enough to act.',
    priority: 'normal',
  },
  no_candidate_match: {
    label: 'No candidate on file matches the identifiers in this email.',
    priority: 'normal',
  },
  missing_date: { label: 'No date is stated.', priority: 'normal' },
  missing_time: { label: 'No time is stated.', priority: 'normal' },
  missing_timezone: {
    label: 'A time is stated but no time zone, and one cannot be inferred safely.',
    priority: 'normal',
  },
  missing_required_field: {
    label: 'Something required to create the record is not stated.',
    priority: 'normal',
  },
  insufficient_evidence: {
    label: 'The email does not support the reading firmly enough to act on it.',
    priority: 'normal',
  },
  actor_lacks_permission: {
    label: 'Creating this record is outside the permissions of whoever asked.',
    priority: 'normal',
  },
  stale_event: {
    label: 'The email describes something far enough in the past to be worth checking.',
    priority: 'normal',
  },

  // Low: probably fine, confirm and move on.
  duplicate_detected: {
    label: 'A matching record already exists.',
    priority: 'low',
  },
  unsupported_event: {
    label: 'This kind of event is not created automatically yet.',
    priority: 'low',
  },
  other: { label: 'Held for review.', priority: 'normal' },
};

export const PROPOSAL_REVIEW_STATUSES = [
  'open',
  'in_review',
  'approved',
  'rejected',
  'ignored',
] as const;
export type ProposalReviewStatus = (typeof PROPOSAL_REVIEW_STATUSES)[number];

export const PROPOSAL_REVIEW_STATUS_META: Record<
  ProposalReviewStatus,
  { label: string; tone: 'info' | 'caution' | 'positive' | 'muted' | 'neutral'; isOpen: boolean }
> = {
  open:      { label: 'Waiting',   tone: 'info',     isOpen: true },
  in_review: { label: 'In review', tone: 'caution',  isOpen: true },
  approved:  { label: 'Approved',  tone: 'positive', isOpen: false },
  rejected:  { label: 'Rejected',  tone: 'muted',    isOpen: false },
  ignored:   { label: 'Ignored',   tone: 'muted',    isOpen: false },
};

/**
 * Automation policy, in one table.
 *
 * `interview` and `assessment` may be written automatically when complete;
 * `rejection` never may, because the mistake is unrecoverable in the way that
 * matters — a candidate told they are out of a process they are still in.
 * `recruiter_response` never may, because there is no record to create.
 */
export const AUTOMATION: Record<
  string,
  { automatable: boolean; note: string }
> = {
  application: {
    automatable: true,
    note: 'Creating an application that turns out to be wrong is visible and reversible.',
  },
  interview: {
    automatable: true,
    note: 'Only when the date, the time and the zone are all stated.',
  },
  assessment: {
    automatable: true,
    note: 'Only when the assessment and the company are named.',
  },
  rejection: {
    automatable: false,
    note:
      'Never automatic. Marking somebody rejected on a misread email is the one mistake here ' +
      'that reaches the candidate and cannot be taken back.',
  },
  recruiter_response: {
    automatable: false,
    note: 'There is no record to create; a person decides whether it means anything.',
  },
  other: {
    automatable: false,
    note: 'Nothing to do.',
  },
};

/**
 * How old an event may be and still be written without a person.
 *
 * A mailbox that has not synced for a fortnight delivers a fortnight of
 * scheduling emails at once, some of them describing interviews that have
 * already happened. Creating those silently is worse than asking.
 */
export const MAX_EVENT_AGE_DAYS = 14;

/**
 * Time zones that may be resolved from the words an email uses.
 *
 * Deliberately explicit and short. This is the ONLY inference the engine makes
 * about a time zone: if the email does not name one from this list, the
 * proposal goes to review rather than being assigned the server's zone, the
 * candidate's zone, or anybody's guess.
 */
export const TIMEZONE_PHRASES: Record<string, string> = {
  'eastern time': 'America/New_York',
  'eastern standard time': 'America/New_York',
  'eastern daylight time': 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  'pacific time': 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  'central time': 'America/Chicago',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  'mountain time': 'America/Denver',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  'london time': 'Europe/London',
  gmt: 'Europe/London',
  bst: 'Europe/London',
  'uk time': 'Europe/London',
  'central european time': 'Europe/Berlin',
  cet: 'Europe/Berlin',
  cest: 'Europe/Berlin',
  ist: 'Asia/Kolkata',
  'india standard time': 'Asia/Kolkata',
  'indian standard time': 'Asia/Kolkata',
  'singapore time': 'Asia/Singapore',
  sgt: 'Asia/Singapore',
  aest: 'Australia/Sydney',
  aedt: 'Australia/Sydney',
  utc: 'UTC',
};

/**
 * Domains that host mailboxes for many organisations.
 *
 * Used for ONE narrow, factual observation: the sender's domain is not the
 * company they name. That is not an accusation and is not scored — it is a
 * fact worth a person's glance, stated in those words.
 */
export const GENERIC_MAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
  'icloud.com',
  'aol.com',
] as const;
