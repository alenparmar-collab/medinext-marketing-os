import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type {
  IntelligenceEventType,
  IntelligenceProviderKind,
  IntelligenceStatus,
} from '@/config/statuses';

/**
 * Reads run through the user-scoped client, so RLS decides what comes back. A
 * caller without `intelligence.view` gets zero rows from the database rather
 * than a filtered list from this file.
 */

export interface IntelligenceListItem {
  id: string;
  emailMessageId: string;
  runNumber: number;
  status: IntelligenceStatus;
  eventType: IntelligenceEventType | null;
  eventConfidence: number | null;
  summary: string | null;
  proposedCandidateId: string | null;
  proposedCandidateName: string | null;
  candidateMatchConfidence: number | null;
  provider: IntelligenceProviderKind;
  model: string;
  promptVersion: string;
  createdAt: string;
  completedAt: string | null;
  /** Denormalised for the list, so it does not have to open every email. */
  emailSubject: string | null;
  emailFrom: string;
  emailReceivedAt: string;
}

export interface IntelligenceListPage {
  items: IntelligenceListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IntelligenceListParams {
  status?: IntelligenceStatus | undefined;
  eventType?: IntelligenceEventType | undefined;
  /** Only the newest run per email, which is what an operator usually wants. */
  latestOnly?: boolean;
  page?: number;
  pageSize?: number;
}

// A single literal — concatenation widens the select string to `string` and
// the row type collapses with it. No extracted_data or evidence here: the list
// does not need them and they are the largest columns on the table.
const LIST_COLUMNS =
  'id, email_message_id, run_number, status, event_type, event_confidence, summary, proposed_candidate_id, candidate_match_confidence, provider, model, prompt_version, created_at, completed_at';

export async function listIntelligenceRuns(
  params: IntelligenceListParams,
): Promise<IntelligenceListPage> {
  const supabase = await createServerSupabase();

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));
  const from = (page - 1) * pageSize;

  let query = supabase
    .from('email_intelligence_runs')
    .select(LIST_COLUMNS, { count: 'exact' });

  if (params.status) query = query.eq('status', params.status);
  if (params.eventType) query = query.eq('event_type', params.eventType);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1);

  if (error) throw error;

  let rows = data ?? [];

  if (params.latestOnly) {
    // Applied after the fetch rather than as a lateral join: the page is
    // already bounded, and the alternative is a view this build does not
    // otherwise need.
    const seen = new Set<string>();
    rows = rows.filter((row) => {
      if (seen.has(row.email_message_id)) return false;
      seen.add(row.email_message_id);
      return true;
    });
  }

  if (rows.length === 0) {
    return { items: [], total: count ?? 0, page, pageSize };
  }

  const [emails, candidates] = await Promise.all([
    supabase
      .from('email_messages')
      .select('id, subject, from_address, received_at')
      .in('id', [...new Set(rows.map((r) => r.email_message_id))]),
    (async () => {
      const ids = [...new Set(rows.map((r) => r.proposed_candidate_id).filter(Boolean))] as string[];
      if (ids.length === 0) return { data: [] as { id: string; full_name: string }[] };
      return supabase.from('candidates').select('id, full_name').in('id', ids);
    })(),
  ]);

  const emailById = new Map((emails.data ?? []).map((e) => [e.id, e] as const));
  const candidateById = new Map((candidates.data ?? []).map((c) => [c.id, c.full_name] as const));

  return {
    items: rows.map((row) => {
      const email = emailById.get(row.email_message_id);
      return {
        id: row.id,
        emailMessageId: row.email_message_id,
        runNumber: row.run_number,
        status: row.status,
        eventType: row.event_type,
        eventConfidence: row.event_confidence === null ? null : Number(row.event_confidence),
        summary: row.summary,
        proposedCandidateId: row.proposed_candidate_id,
        proposedCandidateName: row.proposed_candidate_id
          ? (candidateById.get(row.proposed_candidate_id) ?? null)
          : null,
        candidateMatchConfidence:
          row.candidate_match_confidence === null ? null : Number(row.candidate_match_confidence),
        provider: row.provider,
        model: row.model,
        promptVersion: row.prompt_version,
        createdAt: row.created_at,
        completedAt: row.completed_at,
        emailSubject: email?.subject ?? null,
        emailFrom: email?.from_address ?? 'unknown',
        emailReceivedAt: email?.received_at ?? row.created_at,
      };
    }),
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

export interface IntelligenceDetail extends IntelligenceListItem {
  candidateMatchReasons: string[];
  candidateMatchEvidence: Record<string, unknown>;
  extractedData: Record<string, unknown>;
  evidence: { field: string; excerpt: string }[];
  validationOk: boolean | null;
  validationResult: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  requestedByName: string | null;
  startedAt: string | null;
  /** Earlier readings of the same email, so history is visible rather than replaced. */
  otherRuns: { id: string; runNumber: number; status: IntelligenceStatus; createdAt: string }[];
}

const DETAIL_COLUMNS =
  'id, email_message_id, run_number, status, event_type, event_confidence, summary, proposed_candidate_id, candidate_match_confidence, candidate_match_reasons, candidate_match_evidence, extracted_data, evidence, validation_ok, validation_result, error_code, error_message, provider, model, prompt_version, requested_by, started_at, created_at, completed_at';

export async function getIntelligenceRun(runId: string): Promise<IntelligenceDetail> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('email_intelligence_runs')
    .select(DETAIL_COLUMNS)
    .eq('id', runId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Interpretation not found.');

  const [email, candidate, requester, siblings] = await Promise.all([
    supabase
      .from('email_messages')
      .select('id, subject, from_address, received_at')
      .eq('id', data.email_message_id)
      .maybeSingle(),
    data.proposed_candidate_id
      ? supabase
          .from('candidates')
          .select('full_name')
          .eq('id', data.proposed_candidate_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    data.requested_by
      ? supabase.from('users').select('full_name').eq('id', data.requested_by).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('email_intelligence_runs')
      .select('id, run_number, status, created_at')
      .eq('email_message_id', data.email_message_id)
      .order('run_number', { ascending: false }),
  ]);

  return {
    id: data.id,
    emailMessageId: data.email_message_id,
    runNumber: data.run_number,
    status: data.status,
    eventType: data.event_type,
    eventConfidence: data.event_confidence === null ? null : Number(data.event_confidence),
    summary: data.summary,
    proposedCandidateId: data.proposed_candidate_id,
    proposedCandidateName: candidate.data?.full_name ?? null,
    candidateMatchConfidence:
      data.candidate_match_confidence === null ? null : Number(data.candidate_match_confidence),
    candidateMatchReasons: data.candidate_match_reasons,
    candidateMatchEvidence: data.candidate_match_evidence,
    extractedData: data.extracted_data,
    evidence: data.evidence,
    validationOk: data.validation_ok,
    validationResult: data.validation_result,
    errorCode: data.error_code,
    errorMessage: data.error_message,
    provider: data.provider,
    model: data.model,
    promptVersion: data.prompt_version,
    requestedByName: requester.data?.full_name ?? null,
    startedAt: data.started_at,
    createdAt: data.created_at,
    completedAt: data.completed_at,
    emailSubject: email.data?.subject ?? null,
    emailFrom: email.data?.from_address ?? 'unknown',
    emailReceivedAt: email.data?.received_at ?? data.created_at,
    otherRuns: (siblings.data ?? [])
      .filter((r) => r.id !== data.id)
      .map((r) => ({
        id: r.id,
        runNumber: r.run_number,
        status: r.status,
        createdAt: r.created_at,
      })),
  };
}

/** The newest reading of one email, for the email detail page. */
export async function getLatestRunForEmail(
  emailMessageId: string,
): Promise<IntelligenceListItem | null> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('email_intelligence_runs')
    .select(LIST_COLUMNS)
    .eq('email_message_id', emailMessageId)
    .order('run_number', { ascending: false })
    .limit(1);

  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;

  const [email, candidate] = await Promise.all([
    supabase
      .from('email_messages')
      .select('subject, from_address, received_at')
      .eq('id', emailMessageId)
      .maybeSingle(),
    row.proposed_candidate_id
      ? supabase
          .from('candidates')
          .select('full_name')
          .eq('id', row.proposed_candidate_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    id: row.id,
    emailMessageId: row.email_message_id,
    runNumber: row.run_number,
    status: row.status,
    eventType: row.event_type,
    eventConfidence: row.event_confidence === null ? null : Number(row.event_confidence),
    summary: row.summary,
    proposedCandidateId: row.proposed_candidate_id,
    proposedCandidateName: candidate.data?.full_name ?? null,
    candidateMatchConfidence:
      row.candidate_match_confidence === null ? null : Number(row.candidate_match_confidence),
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    emailSubject: email.data?.subject ?? null,
    emailFrom: email.data?.from_address ?? 'unknown',
    emailReceivedAt: email.data?.received_at ?? row.created_at,
  };
}
