import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { IntelligenceEventType, ReviewItemPriority } from '@/config/statuses';
import type {
  DecisionOutcome,
  DecisionReasonCode,
  ProposalReviewStatus,
} from '@/config/decisions';

/**
 * The queue reads a SUMMARY. No email bodies, no evidence arrays, no extracted
 * blobs — a list of forty proposals must not carry forty emails to a browser
 * to render a subject line. The full evidence loads only when one is opened.
 */
export interface ProposalListItem {
  id: string;
  eventType: IntelligenceEventType;
  outcome: DecisionOutcome;
  status: ProposalReviewStatus;
  priority: ReviewItemPriority;
  reasonCodes: DecisionReasonCode[];
  candidateId: string | null;
  candidateName: string | null;
  candidateMatchConfidence: number | null;
  eventConfidence: number | null;
  emailSubject: string | null;
  emailFrom: string;
  emailReceivedAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** The company the proposal is about, read from the proposal itself. */
  company: string | null;
  /** Set when this decision produced a CRM record. */
  createdRecordId: string | null;
  createdRecordKind: 'application' | 'interview' | 'assessment' | null;
  /** True when a later reading disagreed with an earlier decision. */
  interpretationChanged: boolean;
  /** Set when an approval half-completed; drives the PARTIAL FAILURE label. */
  failureCode: string | null;
  claimedByName: string | null;
  claimedAt: string | null;
}

const LIST_COLUMNS =
  'id, event_type, outcome, status, priority, reason_codes, proposed_candidate_id, candidate_match_confidence, event_confidence, email_message_id, created_at, reviewed_at, proposed_data, created_application_id, created_interview_id, created_assessment_id, supersedes_item_id, failure_code, claimed_by, claimed_at';

export interface ProposalListParams {
  status?: ProposalReviewStatus | undefined;
  eventType?: IntelligenceEventType | undefined;
  openOnly?: boolean;
  priority?: ReviewItemPriority | undefined;
  /** Only decisions a later reading disagreed with. */
  changedOnly?: boolean;
  /** Only approvals that half-completed. */
  failedOnly?: boolean;
  /** Free text over candidate, company, subject, sender and job title. */
  search?: string | undefined;
  limit?: number;
  offset?: number;
}

export interface ProposalPage {
  items: ProposalListItem[];
  /** True when more rows exist beyond this page. */
  hasMore: boolean;
  offset: number;
  limit: number;
}

/**
 * The queue, paginated and filtered.
 *
 * Everything narrowing this list is applied by the DATABASE, on top of RLS —
 * a filter is a convenience for the reviewer, never a way to reach a row the
 * policy would not have returned. Search included: it becomes SQL predicates
 * on the same query, so an unauthorised match is not "hidden", it is not there.
 *
 * Two round trips at most, whatever the page size: the rows, then one lookup
 * each for the emails and candidates they reference. Never one query per row.
 */
export async function listProposals(params: ProposalListParams): Promise<ProposalPage> {
  const supabase = await createServerSupabase();

  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  let query = supabase.from('intelligence_review_items').select(LIST_COLUMNS);

  if (params.status) query = query.eq('status', params.status);
  if (params.eventType) query = query.eq('event_type', params.eventType);
  if (params.openOnly) query = query.in('status', ['open', 'in_review']);
  if (params.priority) query = query.eq('priority', params.priority);
  if (params.changedOnly) query = query.not('supersedes_item_id', 'is', null);
  if (params.failedOnly) query = query.not('failure_code', 'is', null);

  // Candidate and company are resolved first so the text search can run as one
  // database predicate rather than by filtering rows in this process — which
  // would page through the wrong rows and quietly drop matches.
  const term = params.search?.trim();
  if (term) {
    const [candidateIds, emailIds] = await Promise.all([
      supabase.from('candidates').select('id').ilike('full_name', `%${term}%`),
      supabase
        .from('email_messages')
        .select('id')
        .or(`subject.ilike.%${term}%,from_address.ilike.%${term}%`),
    ]);

    // Both lookups run through the caller's client, so they can only ever
    // return rows this person may already read.
    const ids = (candidateIds.data ?? []).map((r) => r.id);
    const messages = (emailIds.data ?? []).map((r) => r.id);

    const clauses = [
      `proposed_data->>company.ilike.%${term}%`,
      `proposed_data->>job_title.ilike.%${term}%`,
      ...(ids.length > 0 ? [`proposed_candidate_id.in.(${ids.join(',')})`] : []),
      ...(messages.length > 0 ? [`email_message_id.in.(${messages.join(',')})`] : []),
    ];
    query = query.or(clauses.join(','));
  }

  // One row beyond the page, so "is there more" costs nothing extra.
  const { data, error } = await query
    // High priority first, then oldest: the queue is worked from the top.
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .range(offset, offset + limit);

  if (error) throw error;

  const all = data ?? [];
  const hasMore = all.length > limit;
  const rows = hasMore ? all.slice(0, limit) : all;
  if (rows.length === 0) return { items: [], hasMore: false, offset, limit };

  const [emails, candidates, claimers] = await Promise.all([
    supabase
      .from('email_messages')
      .select('id, subject, from_address, received_at')
      .in('id', [...new Set(rows.map((r) => r.email_message_id))]),
    (async () => {
      const ids = [...new Set(rows.map((r) => r.proposed_candidate_id).filter(Boolean))] as string[];
      if (ids.length === 0) return { data: [] as { id: string; full_name: string }[] };
      return supabase.from('candidates').select('id, full_name').in('id', ids);
    })(),
    (async () => {
      const ids = [...new Set(rows.map((r) => r.claimed_by).filter(Boolean))] as string[];
      if (ids.length === 0) return { data: [] as { id: string; full_name: string }[] };
      return supabase.from('users').select('id, full_name').in('id', ids);
    })(),
  ]);

  const emailById = new Map((emails.data ?? []).map((e) => [e.id, e] as const));
  const nameById = new Map((candidates.data ?? []).map((c) => [c.id, c.full_name] as const));
  const userById = new Map((claimers.data ?? []).map((u) => [u.id, u.full_name] as const));

  const items = rows.map((row) => {
    const proposed = (row.proposed_data ?? {}) as Record<string, unknown>;
    const company = typeof proposed.company === 'string' ? proposed.company : null;

    return {
      id: row.id,
      eventType: row.event_type,
      outcome: row.outcome,
      status: row.status,
      priority: row.priority,
      reasonCodes: row.reason_codes,
      candidateId: row.proposed_candidate_id,
      candidateName: row.proposed_candidate_id
        ? (nameById.get(row.proposed_candidate_id) ?? null)
        : null,
      candidateMatchConfidence:
        row.candidate_match_confidence === null ? null : Number(row.candidate_match_confidence),
      eventConfidence: row.event_confidence === null ? null : Number(row.event_confidence),
      emailSubject: emailById.get(row.email_message_id)?.subject ?? null,
      emailFrom: emailById.get(row.email_message_id)?.from_address ?? 'unknown',
      emailReceivedAt: emailById.get(row.email_message_id)?.received_at ?? null,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      company,
      createdRecordId:
        row.created_interview_id ?? row.created_assessment_id ?? row.created_application_id ?? null,
      createdRecordKind: row.created_interview_id
        ? ('interview' as const)
        : row.created_assessment_id
          ? ('assessment' as const)
          : row.created_application_id
            ? ('application' as const)
            : null,
      interpretationChanged: row.supersedes_item_id !== null,
      failureCode: row.failure_code,
      claimedByName: row.claimed_by ? (userById.get(row.claimed_by) ?? null) : null,
      claimedAt: row.claimed_at,
    };
  });

  return { items, hasMore, offset, limit };
}

export interface ProposalDetail extends ProposalListItem {
  intelligenceRunId: string;
  emailMessageId: string;
  explanation: string | null;
  proposedData: Record<string, unknown>;
  correctedData: Record<string, unknown> | null;
  finalData: Record<string, unknown> | null;
  decisionNotes: string | null;
  reviewedByName: string | null;
  createdApplicationId: string | null;
  createdInterviewId: string | null;
  createdAssessmentId: string | null;
  /** The evidence, loaded only here. */
  email: {
    subject: string | null;
    fromAddress: string;
    fromName: string | null;
    toAddresses: string[];
    receivedAt: string;
    bodyText: string | null;
  };
  evidence: { field: string; excerpt: string }[];
  candidateMatchReasons: string[];
  /**
   * Candidates the reviewer MAY ALREADY SEE whose name or address appears in
   * the message. Offered when matching resolved nobody — never chosen for them,
   * and never sourced from outside their own RLS scope.
   */
  possibleCandidates: { id: string; fullName: string; email: string; why: string }[];
  /** Identifiers the reading reported seeing in the message. */
  observedIdentifiers: {
    emailAddresses: string[];
    phoneNumbers: string[];
    personNames: string[];
  };
  /** The record this decision produced, resolved for display. */
  createdRecord: {
    kind: 'application' | 'interview' | 'assessment';
    id: string;
    label: string;
    href: string;
  } | null;
  /** Server-computed fingerprint of the material proposal. */
  fingerprint: string;
  /** Structured recovery facts for a half-completed approval. Never model output. */
  failureDetail: Record<string, unknown> | null;
  failedAt: string | null;
  /**
   * Set only when this decision came from a later reading that disagreed with
   * an earlier one. Structured facts — two proposals, the fields that moved,
   * the record already on file — and no model reasoning.
   */
  interpretationChange: {
    previousItemId: string;
    previousFingerprint: string | null;
    previousStatus: string | null;
    previousDecidedAt: string | null;
    previousData: Record<string, unknown> | null;
    changedFields: string[];
    existingRecordId: string | null;
    existingRecordKind: string | null;
  } | null;
}

const DETAIL_COLUMNS =
  'id, business_unit_id, intelligence_run_id, email_message_id, event_type, outcome, status, priority, reason_codes, explanation, proposed_candidate_id, proposed_data, corrected_data, final_data, candidate_match_confidence, event_confidence, decision_notes, reviewed_by, reviewed_at, created_application_id, created_interview_id, created_assessment_id, created_at, proposal_fingerprint, claimed_at, supersedes_item_id, superseded_fingerprint, superseded_record_id, superseded_record_kind, changed_fields, claimed_by, failure_code, failure_detail, failed_at';

export async function getProposal(proposalId: string): Promise<ProposalDetail> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('intelligence_review_items')
    .select(DETAIL_COLUMNS)
    .eq('id', proposalId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Proposal not found.');

  const [email, run, candidate, reviewer, previous, claimer] = await Promise.all([
    supabase
      .from('email_messages')
      .select('subject, from_address, from_name, to_addresses, received_at, body_text')
      .eq('id', data.email_message_id)
      .maybeSingle(),
    supabase
      .from('email_intelligence_runs')
      .select('evidence, candidate_match_reasons, observed_identifiers')
      .eq('id', data.intelligence_run_id)
      .maybeSingle(),
    data.proposed_candidate_id
      ? supabase
          .from('candidates')
          .select('full_name')
          .eq('id', data.proposed_candidate_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    data.reviewed_by
      ? supabase.from('users').select('full_name').eq('id', data.reviewed_by).maybeSingle()
      : Promise.resolve({ data: null }),
    // The decision this one disagrees with, when there is one. Read through the
    // caller's client like everything else, so a superseded decision from
    // another tenant simply does not come back.
    data.supersedes_item_id
      ? supabase
          .from('intelligence_review_items')
          .select('id, status, event_type, proposed_data, final_data, reviewed_at, created_at')
          .eq('id', data.supersedes_item_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Who holds the claim, so the page can say so by name rather than "someone".
    data.claimed_by
      ? supabase.from('users').select('full_name').eq('id', data.claimed_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const observed = (run.data?.observed_identifiers ?? {}) as Record<string, unknown>;

  // Offered only when the server could NOT resolve a candidate. Read through
  // the caller's own client, so this can never surface somebody outside their
  // unit or tenant — and it proposes nothing: the matching rules stay
  // authoritative, and a name alone is still not an identifier.
  const possibleCandidates = data.proposed_candidate_id
    ? []
    : await findPossibleCandidates(supabase, {
        emailAddresses: asStrings(observed.email_addresses),
        personNames: asStrings(observed.person_names),
      });

  const createdRecord = data.created_interview_id
    ? {
        kind: 'interview' as const,
        id: data.created_interview_id,
        label: 'Interview',
        href: `/interviews/${data.created_interview_id}`,
      }
    : data.created_assessment_id
      ? {
          kind: 'assessment' as const,
          id: data.created_assessment_id,
          label: 'Assessment',
          href: `/assessments/${data.created_assessment_id}`,
        }
      : data.created_application_id
        ? {
            kind: 'application' as const,
            id: data.created_application_id,
            label: 'Application',
            href: `/applications/${data.created_application_id}`,
          }
        : null;

  return {
    id: data.id,
    intelligenceRunId: data.intelligence_run_id,
    emailMessageId: data.email_message_id,
    eventType: data.event_type,
    outcome: data.outcome,
    status: data.status,
    priority: data.priority,
    reasonCodes: data.reason_codes,
    explanation: data.explanation,
    candidateId: data.proposed_candidate_id,
    candidateName: candidate.data?.full_name ?? null,
    candidateMatchConfidence:
      data.candidate_match_confidence === null ? null : Number(data.candidate_match_confidence),
    eventConfidence: data.event_confidence === null ? null : Number(data.event_confidence),
    proposedData: data.proposed_data,
    correctedData: data.corrected_data,
    finalData: data.final_data,
    decisionNotes: data.decision_notes,
    reviewedByName: reviewer.data?.full_name ?? null,
    createdApplicationId: data.created_application_id,
    createdInterviewId: data.created_interview_id,
    createdAssessmentId: data.created_assessment_id,
    emailSubject: email.data?.subject ?? null,
    emailFrom: email.data?.from_address ?? 'unknown',
    createdAt: data.created_at,
    reviewedAt: data.reviewed_at,
    email: {
      subject: email.data?.subject ?? null,
      fromAddress: email.data?.from_address ?? 'unknown',
      fromName: email.data?.from_name ?? null,
      toAddresses: email.data?.to_addresses ?? [],
      receivedAt: email.data?.received_at ?? data.created_at,
      bodyText: email.data?.body_text ?? null,
    },
    evidence: (run.data?.evidence as { field: string; excerpt: string }[] | undefined) ?? [],
    candidateMatchReasons: run.data?.candidate_match_reasons ?? [],
    observedIdentifiers: {
      emailAddresses: asStrings(observed.email_addresses),
      phoneNumbers: asStrings(observed.phone_numbers),
      personNames: asStrings(observed.person_names),
    },
    possibleCandidates,
    createdRecord,
    fingerprint: data.proposal_fingerprint,
    emailReceivedAt: email.data?.received_at ?? null,
    company: typeof (data.proposed_data as Record<string, unknown>)?.company === 'string'
      ? ((data.proposed_data as Record<string, unknown>).company as string)
      : null,
    createdRecordId:
      data.created_interview_id ?? data.created_assessment_id ?? data.created_application_id ?? null,
    createdRecordKind: data.created_interview_id
      ? ('interview' as const)
      : data.created_assessment_id
        ? ('assessment' as const)
        : data.created_application_id
          ? ('application' as const)
          : null,
    interpretationChanged: data.supersedes_item_id !== null,
    failureCode: data.failure_code,
    failureDetail: data.failure_detail,
    failedAt: data.failed_at,
    claimedByName: claimer.data?.full_name ?? null,
    claimedAt: data.claimed_at,
    // Present only when a later reading disagreed with an earlier decision.
    // Factual and structured: two proposals, the fields that moved, and the
    // record already on file. No model reasoning of any kind.
    interpretationChange: data.supersedes_item_id
      ? {
          previousItemId: data.supersedes_item_id,
          previousFingerprint: data.superseded_fingerprint,
          previousStatus: previous.data?.status ?? null,
          previousDecidedAt: previous.data?.reviewed_at ?? previous.data?.created_at ?? null,
          previousData:
            ((previous.data?.final_data ?? previous.data?.proposed_data) as Record<
              string,
              unknown
            > | null) ?? null,
          changedFields: data.changed_fields ?? [],
          existingRecordId: data.superseded_record_id,
          existingRecordKind: data.superseded_record_kind,
        }
      : null,
  };
}

/** Counts for the dashboard. RLS-filtered, so each unit sees its own. */
export interface ProposalActivity {
  openCount: number;
  autoApprovedToday: number;
  humanApprovedToday: number;
  reviewRequiredToday: number;
  ignoredToday: number;
}

export async function getProposalActivity(): Promise<ProposalActivity> {
  const supabase = await createServerSupabase();
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('intelligence_review_items')
    .select('status, outcome, created_at, reviewed_by');

  if (error) throw error;
  const rows = data ?? [];
  const today = (value: string) => Date.parse(value) >= startOfToday.getTime();

  return {
    openCount: rows.filter((r) => r.status === 'open' || r.status === 'in_review').length,
    // Auto-approved and human-approved are counted apart: "how much did the
    // machine do on its own" is the question this exists to answer.
    autoApprovedToday: rows.filter(
      (r) => r.status === 'approved' && r.outcome === 'auto_approve' && r.reviewed_by === null && today(r.created_at),
    ).length,
    humanApprovedToday: rows.filter(
      (r) => r.status === 'approved' && r.reviewed_by !== null && today(r.created_at),
    ).length,
    reviewRequiredToday: rows.filter(
      (r) => r.outcome === 'review_required' && today(r.created_at),
    ).length,
    ignoredToday: rows.filter((r) => r.status === 'ignored' && today(r.created_at)).length,
  };
}

/** jsonb arrays arrive as unknown; nothing downstream should have to guess. */
function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Candidates that MIGHT be the person, for a human to choose between.
 *
 * Deliberately not a matcher. It runs only when the server's matching resolved
 * nobody, it returns at most a handful, it says why each one appeared, and it
 * ranks nothing — presenting a "best" candidate is how a name-only guess turns
 * into an attached rejection on the wrong person's file.
 *
 * Scoped by the caller's client, so the list is a subset of what they can
 * already open from /candidates.
 */
async function findPossibleCandidates(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  observed: { emailAddresses: string[]; personNames: string[] },
): Promise<{ id: string; fullName: string; email: string; why: string }[]> {
  const found = new Map<string, { id: string; fullName: string; email: string; why: string }>();

  if (observed.emailAddresses.length > 0) {
    const { data } = await supabase
      .from('candidates')
      .select('id, full_name, email')
      .in('email', observed.emailAddresses.slice(0, 10))
      .is('archived_at', null)
      .limit(10);

    for (const row of data ?? []) {
      found.set(row.id, {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        why: 'Their email address appears in the message.',
      });
    }
  }

  for (const name of observed.personNames.slice(0, 3)) {
    if (name.trim().length < 3) continue;
    const { data } = await supabase
      .from('candidates')
      .select('id, full_name, email')
      .ilike('full_name', `%${name.trim()}%`)
      .is('archived_at', null)
      .limit(5);

    for (const row of data ?? []) {
      if (found.has(row.id)) continue;
      found.set(row.id, {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        why: `Their name matches "${name.trim()}" in the message. A name is not an identifier.`,
      });
    }
  }

  return [...found.values()].slice(0, 8);
}
