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
  createdAt: string;
  reviewedAt: string | null;
}

const LIST_COLUMNS =
  'id, event_type, outcome, status, priority, reason_codes, proposed_candidate_id, candidate_match_confidence, event_confidence, email_message_id, created_at, reviewed_at';

export interface ProposalListParams {
  status?: ProposalReviewStatus | undefined;
  eventType?: IntelligenceEventType | undefined;
  openOnly?: boolean;
  limit?: number;
}

export async function listProposals(params: ProposalListParams): Promise<ProposalListItem[]> {
  const supabase = await createServerSupabase();

  let query = supabase.from('intelligence_review_items').select(LIST_COLUMNS);

  if (params.status) query = query.eq('status', params.status);
  if (params.eventType) query = query.eq('event_type', params.eventType);
  if (params.openOnly) query = query.in('status', ['open', 'in_review']);

  const { data, error } = await query
    // High priority first, then oldest: the queue is worked from the top.
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(params.limit ?? 100);

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const [emails, candidates] = await Promise.all([
    supabase
      .from('email_messages')
      .select('id, subject, from_address')
      .in('id', [...new Set(rows.map((r) => r.email_message_id))]),
    (async () => {
      const ids = [...new Set(rows.map((r) => r.proposed_candidate_id).filter(Boolean))] as string[];
      if (ids.length === 0) return { data: [] as { id: string; full_name: string }[] };
      return supabase.from('candidates').select('id, full_name').in('id', ids);
    })(),
  ]);

  const emailById = new Map((emails.data ?? []).map((e) => [e.id, e] as const));
  const nameById = new Map((candidates.data ?? []).map((c) => [c.id, c.full_name] as const));

  return rows.map((row) => ({
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
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  }));
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
}

const DETAIL_COLUMNS =
  'id, business_unit_id, intelligence_run_id, email_message_id, event_type, outcome, status, priority, reason_codes, explanation, proposed_candidate_id, proposed_data, corrected_data, final_data, candidate_match_confidence, event_confidence, decision_notes, reviewed_by, reviewed_at, created_application_id, created_interview_id, created_assessment_id, created_at';

export async function getProposal(proposalId: string): Promise<ProposalDetail> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('intelligence_review_items')
    .select(DETAIL_COLUMNS)
    .eq('id', proposalId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Proposal not found.');

  const [email, run, candidate, reviewer] = await Promise.all([
    supabase
      .from('email_messages')
      .select('subject, from_address, from_name, to_addresses, received_at, body_text')
      .eq('id', data.email_message_id)
      .maybeSingle(),
    supabase
      .from('email_intelligence_runs')
      .select('evidence, candidate_match_reasons')
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
  ]);

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
