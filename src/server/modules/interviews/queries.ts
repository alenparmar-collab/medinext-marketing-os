import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { InterviewStatus, SourceKind } from '@/config/statuses';
import { UPCOMING_INTERVIEW_STATUSES } from '@/config/statuses';
import type { InterviewDetail, InterviewListItem } from './types';

/**
 * Reads run through the user-scoped client, so RLS decides what comes back.
 * Select strings are single literals — Supabase infers the row shape from the
 * literal type, and concatenation widens it to `string`.
 */
const LIST_COLUMNS =
  'id, candidate_id, application_id, interview_round, scheduled_at, time_zone, meeting_url, interviewer_name, status, source_type, is_verified';

// A separate literal rather than LIST_COLUMNS + '...': concatenation widens the
// type to `string`, and Supabase infers the row shape from the literal.
const DETAIL_COLUMNS =
  'id, candidate_id, application_id, interview_round, scheduled_at, time_zone, meeting_url, interviewer_name, status, source_type, is_verified, notes, interviewer_email, responsible_recruiter_id, created_by, source_reference';

type Ctx = Awaited<ReturnType<typeof createServerSupabase>>;

/** Company, position and candidate name, resolved from the applications. */
async function decorate(
  supabase: Ctx,
  rows: {
    id: string;
    candidate_id: string;
    application_id: string;
    interview_round: number;
    scheduled_at: string | null;
    time_zone: string | null;
    meeting_url: string | null;
    interviewer_name: string | null;
    status: string;
    source_type: string;
    is_verified: boolean;
  }[],
): Promise<InterviewListItem[]> {
  if (rows.length === 0) return [];

  const appIds = [...new Set(rows.map((r) => r.application_id))];
  const candidateIds = [...new Set(rows.map((r) => r.candidate_id))];

  const [apps, candidates] = await Promise.all([
    supabase
      .from('applications')
      .select('id, company_name, position_title')
      .in('id', appIds),
    supabase.from('candidates').select('id, full_name, reference').in('id', candidateIds),
  ]);

  const appById = new Map((apps.data ?? []).map((a) => [a.id, a] as const));
  const candById = new Map((candidates.data ?? []).map((c) => [c.id, c] as const));
  const now = Date.now();

  return rows.map((r) => {
    const app = appById.get(r.application_id);
    const cand = candById.get(r.candidate_id);
    const status = r.status as InterviewStatus;
    return {
      id: r.id,
      candidateId: r.candidate_id,
      candidateName: cand?.full_name ?? 'Unknown candidate',
      candidateReference: cand?.reference ?? '—',
      applicationId: r.application_id,
      companyName: app?.company_name ?? 'Unknown company',
      positionTitle: app?.position_title ?? 'Unknown role',
      interviewRound: r.interview_round,
      scheduledAt: r.scheduled_at,
      timeZone: r.time_zone,
      meetingUrl: r.meeting_url,
      interviewerName: r.interviewer_name,
      status,
      sourceType: r.source_type as SourceKind,
      isVerified: r.is_verified,
      isUpcoming:
        (UPCOMING_INTERVIEW_STATUSES as readonly string[]).includes(status) &&
        r.scheduled_at !== null &&
        Date.parse(r.scheduled_at) >= now,
    };
  });
}

export async function listInterviews(params: {
  candidateId?: string;
  applicationId?: string;
  upcomingOnly?: boolean;
  limit?: number;
}): Promise<InterviewListItem[]> {
  const supabase = await createServerSupabase();

  let query = supabase.from('interviews').select(LIST_COLUMNS);

  if (params.candidateId) query = query.eq('candidate_id', params.candidateId);
  if (params.applicationId) query = query.eq('application_id', params.applicationId);
  if (params.upcomingOnly) {
    query = query
      .in('status', [...UPCOMING_INTERVIEW_STATUSES])
      .gte('scheduled_at', new Date().toISOString());
  }

  const { data, error } = await query
    .order('scheduled_at', { ascending: params.upcomingOnly ?? false })
    .limit(params.limit ?? 100);

  if (error) throw error;
  return decorate(supabase, data ?? []);
}

export async function getInterview(interviewId: string): Promise<InterviewDetail> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('interviews')
    .select(DETAIL_COLUMNS)
    .eq('id', interviewId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Interview not found.');

  const [base] = await decorate(supabase, [data]);
  if (!base) throw new AppError('NOT_FOUND', 'Interview not found.');

  // Ownership and provenance are two different people, so both names are
  // resolved and shown separately on the page.
  const attributionIds = [data.responsible_recruiter_id, data.created_by].filter(
    Boolean,
  ) as string[];
  const attributionNames = new Map<string, string>();
  if (attributionIds.length > 0) {
    const { data: people } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', attributionIds);
    for (const person of people ?? []) attributionNames.set(person.id, person.full_name);
  }

  const { data: history } = await supabase
    .from('interview_schedule_history')
    .select(
      'id, change_kind, previous_scheduled_at, previous_time_zone, previous_status, new_scheduled_at, new_time_zone, new_status, reason, changed_at, changed_by',
    )
    .eq('interview_id', interviewId)
    .order('changed_at', { ascending: false });

  const rows = history ?? [];
  const actorIds = [...new Set(rows.map((h) => h.changed_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', actorIds);
    for (const u of users ?? []) names.set(u.id, u.full_name);
  }

  return {
    ...base,
    notes: data.notes,
    interviewerEmail: data.interviewer_email,
    sourceReference: data.source_reference,
    responsibleRecruiterId: data.responsible_recruiter_id,
    responsibleRecruiterName: data.responsible_recruiter_id
      ? (attributionNames.get(data.responsible_recruiter_id) ?? null)
      : null,
    createdByName: data.created_by ? (attributionNames.get(data.created_by) ?? null) : null,
    history: rows.map((h) => ({
      id: h.id,
      changeKind: h.change_kind,
      previousScheduledAt: h.previous_scheduled_at,
      previousTimeZone: h.previous_time_zone,
      newScheduledAt: h.new_scheduled_at,
      newTimeZone: h.new_time_zone,
      previousStatus: h.previous_status as InterviewStatus | null,
      newStatus: h.new_status as InterviewStatus | null,
      reason: h.reason,
      changedAt: h.changed_at,
      changedByName: h.changed_by ? (names.get(h.changed_by) ?? null) : null,
    })),
  };
}
