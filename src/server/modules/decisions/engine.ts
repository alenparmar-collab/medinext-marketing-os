import {
  AUTOMATION,
  GENERIC_MAIL_DOMAINS,
  MAX_EVENT_AGE_DAYS,
  TIMEZONE_PHRASES,
  type DecisionOutcome,
  type DecisionReasonCode,
} from '@/config/decisions';
import { CONFIDENCE } from '@/config/intelligence';
import { fingerprintProposal, materialDifferences } from './fingerprint';

/**
 * The decision engine.
 *
 * Pure, deterministic, and free of I/O: everything it needs is passed in, so
 * every rule can be tested directly rather than through a database. The same
 * input always produces the same decision, which is what makes an automated
 * write defensible after the fact.
 *
 * The rule the build turns on: CONFIDENCE ALONE NEVER DECIDES. A model that is
 * 0.99 sure an email describes an interview has told us nothing about whether
 * the interview has a date, whether we already hold it, whether it contradicts
 * one on file, or whether the person asking may create one. Each of those is
 * checked separately, and any of them alone sends the proposal to a human.
 */

export interface CandidateFacts {
  id: string;
  fullName: string;
  email: string;
}

export interface ExistingApplication {
  id: string;
  companyName: string;
  positionTitle: string;
  jobId: string | null;
  status: string;
  applicationDate: string;
}

export interface ExistingInterview {
  id: string;
  applicationId: string;
  scheduledAt: string | null;
  status: string;
}

export interface ExistingAssessment {
  id: string;
  applicationId: string;
  assessmentType: string;
  deadline: string | null;
  status: string;
}

/** Everything the engine is allowed to consider. Nothing is fetched inside. */
export interface DecisionInput {
  eventType: string;
  eventConfidence: number | null;
  candidateId: string | null;
  candidateMatchConfidence: number | null;
  candidate: CandidateFacts | null;

  extracted: Record<string, unknown>;
  /** The message body, for the narrow time-zone and sender observations only. */
  emailBody: string;
  emailFromAddress: string;
  emailReceivedAt: string;

  /** Current CRM state for the proposed candidate, already tenant-scoped. */
  existingApplications: ExistingApplication[];
  existingInterviews: ExistingInterview[];
  existingAssessments: ExistingAssessment[];

  /**
   * The decision already recorded for this email and event type, if there is
   * one. Not just "have we seen this" — what we DID, and the fingerprint of the
   * proposal we did it on, so a second reading that says something different
   * can be told apart from a second reading that says the same thing.
   */
  alreadyActioned: {
    itemId: string;
    status: string;
    /** Server-computed fingerprint of the proposal that decision was made on. */
    fingerprint: string | null;
    /** The proposal as it was decided, for naming which field moved. */
    proposedData: Record<string, unknown> | null;
    candidateId: string | null;
    createdRecordId: string | null;
    createdRecordKind: 'application' | 'interview' | 'assessment' | 'rejection' | null;
  } | null;

  /** What the person who triggered this may actually do. */
  actorPermissions: ReadonlySet<string>;

  /** Injected so the engine stays pure and its tests stay stable. */
  now: Date;
}

export interface Decision {
  outcome: DecisionOutcome;
  reasonCodes: DecisionReasonCode[];
  explanation: string;
  /** Highest priority among the reasons. Never chosen by the model. */
  priority: 'low' | 'normal' | 'high';
  /**
   * The values that would be written. Present whenever a record COULD be
   * created — including on review, so the queue can show a reviewer exactly
   * what approving would do.
   */
  proposedData: Record<string, unknown>;
  /** Set when a duplicate or conflict names a specific record. */
  relatedRecordId: string | null;
  /**
   * Fingerprint of THIS proposal. Server-computed, never from the model, and
   * the thing the idempotency key is built from.
   */
  fingerprint: string;
  /**
   * Set only when a previous decision for this email and event type was made on
   * a materially different proposal. Everything a reviewer needs to see that
   * the email was already acted on and that the latest reading disagrees.
   */
  interpretationChange: {
    previousItemId: string;
    previousStatus: string;
    previousFingerprint: string | null;
    previousData: Record<string, unknown> | null;
    changedFields: string[];
    existingRecordId: string | null;
    existingRecordKind: 'application' | 'interview' | 'assessment' | 'rejection' | null;
  } | null;
}

const PERMISSION_FOR_EVENT: Record<string, string> = {
  application: 'application.create',
  interview: 'interview.manage',
  assessment: 'assessment.manage',
  rejection: 'application.update',
};

export function decide(input: DecisionInput): Decision {
  const reasons: DecisionReasonCode[] = [];
  const notes: string[] = [];
  let related: string | null = null;

  const extracted = input.extracted as Record<string, string | null | undefined>;
  const company = text(extracted.company);
  const jobTitle = text(extracted.job_title);
  const reference = text(extracted.external_reference);

  // ---- Nothing to do ----------------------------------------------------
  if (input.eventType === 'other') {
    return settle(input, {
      outcome: 'ignore',
      reasonCodes: [],
      explanation: 'The email is not about an application, interview, assessment or rejection.',
      priority: 'low',
      proposedData: {},
      relatedRecordId: null,
    });
  }

  // Whether this email has already been decided on is settled at the END, in
  // `settle()`, because the answer depends on the proposal this reading
  // produces — and that is not known until the rules below have run.

  // ---- Candidate identity -------------------------------------------------
  if (!input.candidateId) {
    reasons.push('no_candidate_match');
    notes.push('No candidate on file matches the identifiers in this email.');
  } else if ((input.candidateMatchConfidence ?? 0) < CONFIDENCE.high) {
    reasons.push('low_candidate_confidence');
    notes.push(
      `The candidate proposal scores ${format(input.candidateMatchConfidence)}, below the ` +
        'threshold for acting without review.',
    );
  }

  // ---- Classification confidence -----------------------------------------
  if ((input.eventConfidence ?? 0) < CONFIDENCE.high) {
    reasons.push('insufficient_evidence');
    notes.push(
      `The reading scores ${format(input.eventConfidence)}, below the threshold for acting ` +
        'without review.',
    );
  }

  // ---- Is this kind of event automatable at all? -------------------------
  const policy = AUTOMATION[input.eventType];
  if (!policy || !policy.automatable) {
    reasons.push(input.eventType === 'rejection' ? 'status_transition_not_allowed' : 'unsupported_event');
    notes.push(policy?.note ?? 'This kind of event is not written automatically.');
  }

  // ---- Permission --------------------------------------------------------
  //
  // Automation runs with the authority of the person who asked for it. There
  // is no ambient system authority anywhere in this pipeline: if they could
  // not create the record by hand, it is not created for them.
  const required = PERMISSION_FOR_EVENT[input.eventType];
  if (required && !input.actorPermissions.has(required)) {
    reasons.push('actor_lacks_permission');
    notes.push(`Creating this record needs ${required}, which the requester does not hold.`);
  }

  // ---- Freshness ---------------------------------------------------------
  const ageDays = daysBetween(new Date(input.emailReceivedAt), input.now);
  if (ageDays > MAX_EVENT_AGE_DAYS) {
    reasons.push('stale_event');
    notes.push(`The email is ${Math.round(ageDays)} days old.`);
  }

  // ---- Sender observation ------------------------------------------------
  //
  // Factual and narrow. Not a trust score, not an accusation.
  const senderNote = describeSender(input.emailFromAddress, company);
  if (senderNote) {
    reasons.push('third_party_sender');
    notes.push(senderNote);
  }

  // ---- Candidate information consistency ---------------------------------
  if (input.candidate) {
    const mismatch = describeCandidateMismatch(input.candidate, input.emailBody);
    if (mismatch) {
      reasons.push('conflicting_candidate_information');
      notes.push(mismatch);
    }
  }

  // ---- Per-event completeness, duplicates and conflicts ------------------
  let proposedData: Record<string, unknown> = {};

  if (input.eventType === 'application') {
    if (!company) {
      reasons.push('missing_required_field');
      notes.push('The company is not stated.');
    }
    if (!jobTitle) {
      reasons.push('missing_required_field');
      notes.push('The job title is not stated.');
    }

    const duplicate = input.existingApplications.find(
      (a) =>
        same(a.companyName, company) &&
        (same(a.positionTitle, jobTitle) || (reference !== null && same(a.jobId, reference))),
    );
    if (duplicate) {
      reasons.push('duplicate_detected');
      notes.push(
        `An application to ${duplicate.companyName} for ${duplicate.positionTitle} is already on file.`,
      );
      related = duplicate.id;
    }

    proposedData = {
      company,
      job_title: jobTitle,
      external_reference: reference,
      application_date: text(extracted.application_date) ?? isoDate(input.emailReceivedAt),
    };
  }

  if (input.eventType === 'interview') {
    const date = text(extracted.interview_date);
    const time = text(extracted.interview_time);
    const zone = resolveTimeZone(text(extracted.timezone), input.emailBody);

    if (!company) {
      reasons.push('missing_required_field');
      notes.push('The company is not stated.');
    }
    if (!date) {
      reasons.push('missing_date');
      notes.push('No interview date is stated.');
    }
    if (!time) {
      reasons.push('missing_time');
      notes.push('No interview time is stated.');
    }
    // The rule this build is most careful about: a time with no zone is not a
    // time. Nothing is assumed — not the server's zone, not the candidate's,
    // not the company's.
    if (time && !zone) {
      reasons.push('missing_timezone');
      notes.push(
        'A time is given but no time zone, and the email does not name one that can be ' +
          'resolved. Nothing is assumed.',
      );
    }

    const application = findApplication(input.existingApplications, company, jobTitle, reference);
    if (!application) {
      reasons.push('missing_required_field');
      notes.push(
        'No application on file matches this company and role, and an interview must belong to one.',
      );
    }

    if (date && time && zone && application) {
      const scheduledAt = combine(date, time, zone);
      const clash = input.existingInterviews.find(
        (i) => i.applicationId === application.id && i.status !== 'cancelled',
      );

      if (clash) {
        const sameMoment = clash.scheduledAt !== null && sameInstant(clash.scheduledAt, scheduledAt);
        reasons.push(sameMoment ? 'duplicate_detected' : 'conflict_detected');
        notes.push(
          sameMoment
            ? 'An interview for this application is already recorded at that time.'
            : `An interview for this application is already recorded at ${clash.scheduledAt}. ` +
              'This email may be a reschedule, which is a change to that interview rather ' +
              'than a new one.',
        );
        related = clash.id;
      }

      proposedData = {
        application_id: application.id,
        scheduled_at: scheduledAt,
        time_zone: zone,
        company,
        job_title: jobTitle,
        meeting_url: text(extracted.meeting_url),
        interviewer: text(extracted.interviewer),
        external_reference: reference,
      };
    } else {
      proposedData = {
        application_id: application?.id ?? null,
        interview_date: date,
        interview_time: time,
        time_zone: zone,
        company,
        job_title: jobTitle,
        meeting_url: text(extracted.meeting_url),
        interviewer: text(extracted.interviewer),
      };
    }
  }

  if (input.eventType === 'assessment') {
    const name = text(extracted.assessment_name) ?? text(extracted.assessment_type);
    if (!company) {
      reasons.push('missing_required_field');
      notes.push('The company is not stated.');
    }
    if (!name) {
      reasons.push('missing_required_field');
      notes.push('The assessment is not named.');
    }

    const application = findApplication(input.existingApplications, company, jobTitle, reference);
    if (!application) {
      reasons.push('missing_required_field');
      notes.push('No application on file matches this company and role.');
    }

    if (application && name) {
      const existing = input.existingAssessments.find(
        (a) => a.applicationId === application.id && same(a.assessmentType, name),
      );
      if (existing) {
        const deadline = text(extracted.due_date);
        const deadlineDiffers =
          deadline !== null &&
          existing.deadline !== null &&
          isoDate(existing.deadline) !== deadline;

        reasons.push(deadlineDiffers ? 'conflict_detected' : 'duplicate_detected');
        notes.push(
          deadlineDiffers
            ? `An assessment of this kind is already recorded, due ${isoDate(existing.deadline)}, ` +
              `and this email says ${deadline}.`
            : 'An assessment of this kind is already recorded for this application.',
        );
        related = existing.id;
      }
    }

    proposedData = {
      application_id: application?.id ?? null,
      assessment_type: name,
      company,
      job_title: jobTitle,
      due_date: text(extracted.due_date),
      assessment_url: text(extracted.assessment_url),
      external_reference: reference,
    };
  }

  if (input.eventType === 'rejection') {
    const application = findApplication(input.existingApplications, company, jobTitle, reference);

    if (!application) {
      reasons.push('status_transition_not_allowed');
      notes.push(
        'No application on file matches this company and role, so there is nothing to reject.',
      );
    } else {
      related = application.id;
      if (['rejected', 'withdrawn', 'closed'].includes(application.status)) {
        reasons.push('status_transition_not_allowed');
        notes.push(`That application is already ${application.status}.`);
      }
    }

    proposedData = {
      application_id: application?.id ?? null,
      company,
      job_title: jobTitle,
      rejection_date: text(extracted.rejection_date) ?? isoDate(input.emailReceivedAt),
      reason_if_explicit: text(extracted.reason_if_explicit),
    };
  }

  if (input.eventType === 'recruiter_response') {
    proposedData = {
      company,
      job_title: jobTitle,
      response_summary: text(extracted.response_summary),
    };
  }

  // ---- Verdict ------------------------------------------------------------
  if (reasons.length === 0) {
    return settle(input, {
      outcome: 'auto_approve',
      reasonCodes: [],
      explanation:
        'Complete, unambiguous, matched to a candidate with high confidence, and not already ' +
        'on file.',
      priority: 'low',
      proposedData,
      relatedRecordId: related,
    });
  }

  const unique = [...new Set(reasons)];
  return settle(input, {
    outcome: 'review_required',
    reasonCodes: unique,
    explanation: notes.join(' '),
    priority: highestPriority(unique),
    proposedData,
    relatedRecordId: related,
  });
}

/**
 * The last question, asked of every decision: has this email already been
 * decided, and does this reading still say the same thing?
 *
 * It runs here rather than at the top because the comparison is between
 * PROPOSALS — what would be written — not between raw model output. The
 * proposal is what the rules above produce, so the fingerprint cannot be taken
 * until they have run.
 *
 * Three outcomes:
 *
 *   no prior decision       the decision above stands
 *   same fingerprint        ignore — idempotent, nothing new to do or to ask
 *   different fingerprint   REVIEW, always, whatever the decision above said
 *
 * The third is the one that matters. A second reading that moves the interview
 * to a different day is not a duplicate and is not a new interview: it is a
 * disagreement with something already done, and this system does not resolve
 * those. It never edits the existing record, never cancels it, and never
 * writes a second one — it puts both readings in front of a person and names
 * the record already on file.
 */
function settle(
  input: DecisionInput,
  base: Omit<Decision, 'fingerprint' | 'interpretationChange'>,
): Decision {
  const fingerprint = fingerprintProposal(input.eventType, base.proposedData, input.candidateId);
  const prior = input.alreadyActioned;

  if (!prior) return { ...base, fingerprint, interpretationChange: null };

  if (prior.fingerprint === fingerprint) {
    return {
      outcome: 'ignore',
      reasonCodes: [],
      explanation: 'This email has already been decided and the reading has not changed.',
      priority: 'low',
      proposedData: base.proposedData,
      relatedRecordId: prior.createdRecordId ?? base.relatedRecordId,
      fingerprint,
      interpretationChange: null,
    };
  }

  const changedFields = materialDifferences(
    input.eventType,
    prior.proposedData ?? {},
    base.proposedData,
    prior.candidateId,
    input.candidateId,
  );

  const acted = prior.createdRecordId !== null;
  return {
    outcome: 'review_required',
    // The reasons the reading would have been held anyway are kept: a changed
    // interpretation that is ALSO missing a time zone should say both.
    reasonCodes: [...new Set<DecisionReasonCode>([...base.reasonCodes, 'interpretation_changed'])],
    explanation:
      `The latest interpretation of this email differs from the proposal previously ` +
      `${acted ? 'acted upon' : 'recorded'}` +
      (changedFields.length > 0 ? ` (${changedFields.join(', ')})` : '') +
      '. Nothing already on file has been changed. A person should decide which reading is ' +
      'right.' +
      (base.reasonCodes.length > 0 ? ` ${base.explanation}` : ''),
    priority: 'high',
    proposedData: base.proposedData,
    relatedRecordId: prior.createdRecordId ?? base.relatedRecordId,
    fingerprint,
    interpretationChange: {
      previousItemId: prior.itemId,
      previousStatus: prior.status,
      previousFingerprint: prior.fingerprint,
      previousData: prior.proposedData,
      changedFields,
      existingRecordId: prior.createdRecordId,
      existingRecordKind: prior.createdRecordKind,
    },
  };
}

/* ===========================================================================
 * Helpers — small, pure, individually testable
 * ======================================================================== */

/**
 * The ONLY time-zone inference in the system.
 *
 * An explicit IANA zone from the extraction is used as-is. Otherwise the email
 * body is searched for one of a short list of named zones. If neither
 * produces an answer, the answer is null and the proposal goes to a person —
 * it is never the server's zone, the candidate's, or a guess from the company
 * domain.
 */
export function resolveTimeZone(extractedZone: string | null, body: string): string | null {
  if (extractedZone) {
    // An IANA identifier, which is what the extraction schema asks for.
    if (/^[A-Za-z]+\/[A-Za-z_+-]+$/.test(extractedZone) || extractedZone === 'UTC') {
      return extractedZone;
    }
    const named = TIMEZONE_PHRASES[extractedZone.toLowerCase().trim()];
    if (named) return named;
  }

  const haystack = body.toLowerCase();
  // Longest phrases first, so "eastern standard time" is not matched as "est"
  // inside another word.
  const phrases = Object.keys(TIMEZONE_PHRASES).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const pattern = new RegExp(`(^|[^a-z])${escapeRegex(phrase)}([^a-z]|$)`, 'i');
    if (pattern.test(haystack)) return TIMEZONE_PHRASES[phrase] as string;
  }
  return null;
}

/**
 * A factual observation about the sender, or nothing.
 *
 * Says only what can be seen: the sending domain is not the company named in
 * the message. It is never phrased as suspicion and never scored.
 */
export function describeSender(fromAddress: string, company: string | null): string | null {
  if (!company) return null;
  const domain = fromAddress.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  if ((GENERIC_MAIL_DOMAINS as readonly string[]).includes(domain)) {
    return `The email was sent from ${domain}, a general mail provider, while naming ${company}.`;
  }

  const companyToken = company
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|llc|plc|gmbh|group|clinical|research|bio|pharma)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  const domainToken = domain.split('.')[0]?.replace(/[^a-z0-9]/g, '') ?? '';

  if (companyToken.length >= 4 && domainToken.length >= 3) {
    if (!domain.includes(companyToken) && !companyToken.includes(domainToken)) {
      return `The email was sent from ${domain} while naming ${company}; the sender may be a ` +
        'third party acting for them.';
    }
  }
  return null;
}

/**
 * Names in the email that resemble the candidate's without matching it.
 *
 * "Vishnu K." against "Vishnu Kumar" is worth a glance and is not an
 * accusation. The wording says what differs and lets a person decide.
 */
export function describeCandidateMismatch(
  candidate: CandidateFacts,
  body: string,
): string | null {
  const full = candidate.fullName.trim();
  if (full.length === 0) return null;
  if (body.toLowerCase().includes(full.toLowerCase())) return null;

  const first = full.split(/\s+/)[0];
  if (!first || first.length < 3) return null;

  const pattern = new RegExp(`\\b${escapeRegex(first)}\\b[^\\n,.;]{0,30}`, 'i');
  const found = pattern.exec(body);
  if (!found) return null;

  return (
    `The email refers to “${found[0].trim()}” while the record says “${full}”. ` +
    'The two may be the same person written differently.'
  );
}

function findApplication(
  applications: ExistingApplication[],
  company: string | null,
  jobTitle: string | null,
  reference: string | null,
): ExistingApplication | null {
  if (reference) {
    const byReference = applications.find((a) => same(a.jobId, reference));
    if (byReference) return byReference;
  }
  if (!company) return null;

  const candidates = applications.filter((a) => same(a.companyName, company));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] as ExistingApplication;

  const byTitle = candidates.filter((a) => same(a.positionTitle, jobTitle));
  // Two applications to the same company for the same role is genuinely
  // ambiguous; picking one would be a guess.
  return byTitle.length === 1 ? (byTitle[0] as ExistingApplication) : null;
}

export function combine(date: string, time: string, zone: string): string {
  // Resolves the wall-clock time in the named zone to an instant, by measuring
  // that zone's offset at that moment rather than assuming one — a fixed
  // offset would be wrong on either side of a daylight-saving change.
  const naive = new Date(`${date}T${time}:00Z`);
  const offset = zoneOffsetMs(naive, zone);
  return new Date(naive.getTime() - offset).toISOString();
}

function zoneOffsetMs(instant: Date, zone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '00' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

function sameInstant(a: string, b: string): boolean {
  return Math.abs(Date.parse(a) - Date.parse(b)) < 60_000;
}

function highestPriority(codes: DecisionReasonCode[]): 'low' | 'normal' | 'high' {
  const order = { high: 3, normal: 2, low: 1 } as const;
  let best: 'low' | 'normal' | 'high' = 'low';
  for (const code of codes) {
    const meta = DECISION_REASON_PRIORITY[code];
    if (order[meta] > order[best]) best = meta;
  }
  return best;
}

/** Kept beside the engine so the mapping is one lookup rather than an import cycle. */
const DECISION_REASON_PRIORITY: Record<DecisionReasonCode, 'low' | 'normal' | 'high'> = {
  ambiguous_candidate: 'high',
  conflict_detected: 'high',
  conflicting_candidate_information: 'high',
  interpretation_changed: 'high',
  status_transition_not_allowed: 'high',
  third_party_sender: 'high',
  low_candidate_confidence: 'normal',
  no_candidate_match: 'normal',
  missing_date: 'normal',
  missing_time: 'normal',
  missing_timezone: 'normal',
  missing_required_field: 'normal',
  insufficient_evidence: 'normal',
  actor_lacks_permission: 'normal',
  stale_event: 'normal',
  duplicate_detected: 'low',
  unsupported_event: 'low',
  other: 'normal',
};

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function same(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

function format(value: number | null | undefined): string {
  return value === null || value === undefined ? '0%' : `${Math.round(value * 100)}%`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
