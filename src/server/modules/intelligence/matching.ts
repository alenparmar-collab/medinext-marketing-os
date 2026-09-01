import { MATCH } from '@/config/intelligence';
import type { Interpretation } from './schema';

/**
 * Candidate matching, done by the server rather than by the model.
 *
 * The model reports identifiers it observed in the message. This decides what
 * those are worth, against the candidates of one business unit, using rules
 * that do not vary with the weather.
 *
 * The rule that matters most is the one about names. Two candidates called
 * "Priya Raman" is not a hypothetical — recruitment databases are full of
 * shared names — and a system that picks one has a 50% chance of attaching a
 * rejection to the wrong person's file. So a name is never sufficient alone,
 * and an ambiguous name resolves to no proposal at all rather than to a coin
 * flip.
 */

export interface MatchableCandidate {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
}

export interface CandidateMatch {
  candidateId: string | null;
  confidence: number;
  /** Human-readable, shown in the UI and stored on the run. */
  reasons: string[];
  evidence: {
    matchedEmail?: string;
    matchedPhone?: string;
    matchedName?: string;
    /** Named when a name matched more than one candidate. */
    ambiguousAmong?: number;
  };
}

const NO_MATCH: CandidateMatch = {
  candidateId: null,
  confidence: 0,
  reasons: [],
  evidence: {},
};

/**
 * Reduces a phone number to comparable digits.
 *
 * "+44 7700 900123", "07700 900123" and "(0)7700-900123" are the same number
 * written by three people. Comparing the last nine digits handles country
 * prefixes and trunk zeros without pretending to be a real E.164 parser, which
 * would need a country context this product does not collect.
 */
export function phoneKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-9);
}

function nameKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolves observed identifiers to at most one candidate.
 *
 * `candidates` must already be scoped to the caller's business unit — this
 * function does not filter by tenant, and calling it with a wider list would
 * be a cross-tenant proposal. The database's composite foreign key refuses to
 * store one, but the right place to not make the mistake is here.
 */
export function matchCandidate(
  interpretation: Interpretation,
  candidates: MatchableCandidate[],
): CandidateMatch {
  if (candidates.length === 0) return NO_MATCH;

  const observed = interpretation.observed_identifiers;

  // ---- Strongest signal: an exact email address --------------------------
  const emailsSeen = new Set(observed.email_addresses.map((e) => e.toLowerCase()));
  const byEmail = candidates.filter((c) => emailsSeen.has(c.email.toLowerCase()));

  if (byEmail.length === 1) {
    const candidate = byEmail[0] as MatchableCandidate;
    const match: CandidateMatch = {
      candidateId: candidate.id,
      confidence: MATCH.exactEmail,
      reasons: [`The message contains this candidate's email address (${candidate.email}).`],
      evidence: { matchedEmail: candidate.email },
    };

    // Corroboration does not raise an exact-email match — it is already the
    // strongest signal available, and inflating it would only push borderline
    // cases past the review threshold.
    return match;
  }

  if (byEmail.length > 1) {
    // Two candidate records sharing an address is a data-quality problem, not
    // something to resolve by guessing.
    return {
      candidateId: null,
      confidence: 0,
      reasons: [
        `The email address in this message belongs to ${byEmail.length} candidate records.`,
      ],
      evidence: { ambiguousAmong: byEmail.length },
    };
  }

  // ---- Phone number ------------------------------------------------------
  const phonesSeen = new Set(
    observed.phone_numbers.map((p) => phoneKey(p)).filter((p): p is string => p !== null),
  );
  const byPhone = candidates.filter((c) => {
    const key = phoneKey(c.phone);
    return key !== null && phonesSeen.has(key);
  });

  const namesSeen = new Set(observed.person_names.map(nameKey).filter((n) => n.length > 0));
  const byName = candidates.filter((c) => namesSeen.has(nameKey(c.fullName)));

  if (byPhone.length === 1) {
    const candidate = byPhone[0] as MatchableCandidate;
    const nameAlsoMatches = byName.some((c) => c.id === candidate.id);

    const match: CandidateMatch = {
      candidateId: candidate.id,
      confidence: nameAlsoMatches ? MATCH.nameWithCorroboration : MATCH.exactPhone,
      reasons: nameAlsoMatches
        ? ["The message contains this candidate's phone number and their name."]
        : ["The message contains this candidate's phone number."],
      evidence: {
        matchedPhone: candidate.phone ?? undefined,
        ...(nameAlsoMatches ? { matchedName: candidate.fullName } : {}),
      },
    };
    return match;
  }

  // ---- Name -------------------------------------------------------------
  //
  // Never sufficient alone. A single name match with no second signal gets a
  // confidence deliberately below the review threshold: it is a hint for a
  // person, not a proposal to act on.
  if (byName.length === 1) {
    const candidate = byName[0] as MatchableCandidate;
    return {
      candidateId: candidate.id,
      confidence: MATCH.nameAlone,
      reasons: [
        `Only this candidate's name appears in the message, with nothing to corroborate it. ` +
          `A name is not an identifier.`,
      ],
      evidence: { matchedName: candidate.fullName },
    };
  }

  if (byName.length > 1) {
    // The case this rule exists for. No proposal, and the reason says why.
    return {
      candidateId: null,
      confidence: 0,
      reasons: [
        `${byName.length} candidates share the name in this message. ` +
          `Choosing between them needs something the email does not contain.`,
      ],
      evidence: { ambiguousAmong: byName.length },
    };
  }

  return NO_MATCH;
}
