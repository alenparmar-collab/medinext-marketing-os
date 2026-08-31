import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { AssessmentStatus, SourceKind } from '@/config/statuses';
import { OPEN_ASSESSMENT_STATUSES, ASSESSMENT_STATUS_META } from '@/config/statuses';

export interface AssessmentListItem {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateReference: string;
  applicationId: string;
  companyName: string;
  positionTitle: string;
  assessmentType: string;
  assessmentUrl: string | null;
  receivedAt: string;
  deadline: string | null;
  completedAt: string | null;
  status: AssessmentStatus;
  outcome: string | null;
  sourceType: SourceKind;
  isVerified: boolean;
  /** Still waiting on the candidate. */
  isOpen: boolean;
  /** Open, and the deadline has passed. */
  isOverdue: boolean;
}

const LIST_COLUMNS =
  'id, candidate_id, application_id, assessment_type, assessment_url, received_at, deadline, completed_at, status, outcome, source_type, is_verified';

export async function listAssessments(params: {
  candidateId?: string;
  applicationId?: string;
  openOnly?: boolean;
  limit?: number;
}): Promise<AssessmentListItem[]> {
  const supabase = await createServerSupabase();

  let query = supabase.from('assessments').select(LIST_COLUMNS);

  if (params.candidateId) query = query.eq('candidate_id', params.candidateId);
  if (params.applicationId) query = query.eq('application_id', params.applicationId);
  if (params.openOnly) query = query.in('status', [...OPEN_ASSESSMENT_STATUSES]);

  const { data, error } = await query
    // Open assessments are sorted by what is due soonest; history by newest.
    .order(params.openOnly ? 'deadline' : 'received_at', {
      ascending: params.openOnly ?? false,
      nullsFirst: false,
    })
    .limit(params.limit ?? 100);

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const [apps, candidates] = await Promise.all([
    supabase
      .from('applications')
      .select('id, company_name, position_title')
      .in('id', [...new Set(rows.map((r) => r.application_id))]),
    supabase
      .from('candidates')
      .select('id, full_name, reference')
      .in('id', [...new Set(rows.map((r) => r.candidate_id))]),
  ]);

  const appById = new Map((apps.data ?? []).map((a) => [a.id, a] as const));
  const candById = new Map((candidates.data ?? []).map((c) => [c.id, c] as const));
  const now = Date.now();

  return rows.map((r) => {
    const app = appById.get(r.application_id);
    const cand = candById.get(r.candidate_id);
    const status = r.status as AssessmentStatus;
    const isOpen = ASSESSMENT_STATUS_META[status].isOpen;
    return {
      id: r.id,
      candidateId: r.candidate_id,
      candidateName: cand?.full_name ?? 'Unknown candidate',
      candidateReference: cand?.reference ?? '—',
      applicationId: r.application_id,
      companyName: app?.company_name ?? 'Unknown company',
      positionTitle: app?.position_title ?? 'Unknown role',
      assessmentType: r.assessment_type,
      assessmentUrl: r.assessment_url,
      receivedAt: r.received_at,
      deadline: r.deadline,
      completedAt: r.completed_at,
      status,
      outcome: r.outcome,
      sourceType: r.source_type as SourceKind,
      isVerified: r.is_verified,
      isOpen,
      isOverdue: isOpen && r.deadline !== null && Date.parse(r.deadline) < now,
    };
  });
}

export interface AssessmentDetail extends AssessmentListItem {
  notes: string | null;
  sourceReference: string | null;
  /** OWNERSHIP at event time — see applications. */
  responsibleRecruiterId: string | null;
  responsibleRecruiterName: string | null;
  /** PROVENANCE — null when no human created it. */
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

// A separate literal, not LIST_COLUMNS + extras: concatenation widens the
// select string to `string` and the inferred row type collapses with it.
const DETAIL_COLUMNS =
  'id, candidate_id, application_id, assessment_type, assessment_url, received_at, deadline, completed_at, status, outcome, source_type, source_reference, is_verified, notes, responsible_recruiter_id, created_by, created_at, updated_at';

export async function getAssessment(assessmentId: string): Promise<AssessmentDetail> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('assessments')
    .select(DETAIL_COLUMNS)
    .eq('id', assessmentId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Assessment not found.');

  // Reuse the list decoration so one place decides what "open" and "overdue"
  // mean. Two definitions of overdue is two answers to the same question.
  const [base] = await listAssessments({ applicationId: data.application_id, limit: 100 }).then(
    (items) => items.filter((i) => i.id === assessmentId),
  );
  if (!base) throw new AppError('NOT_FOUND', 'Assessment not found.');

  // One lookup for both names: ownership and provenance are shown together and
  // are frequently different people.
  const attributionIds = [data.created_by, data.responsible_recruiter_id].filter(
    Boolean,
  ) as string[];
  const names = new Map<string, string>();
  if (attributionIds.length > 0) {
    const { data: people } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', attributionIds);
    for (const person of people ?? []) names.set(person.id, person.full_name);
  }

  return {
    ...base,
    notes: data.notes,
    sourceReference: data.source_reference,
    responsibleRecruiterId: data.responsible_recruiter_id,
    responsibleRecruiterName: data.responsible_recruiter_id
      ? (names.get(data.responsible_recruiter_id) ?? null)
      : null,
    createdByName: data.created_by ? (names.get(data.created_by) ?? null) : null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}
