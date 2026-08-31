import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ApplicationStatus, SourceKind } from '@/config/statuses';
import type { ApplicationListParams } from './schemas';
import type { ApplicationDetail, ApplicationListItem } from './types';

/**
 * Reads run through the user-scoped client, so RLS decides what comes back.
 * There is no role branching in this file: if a row arrives, the database has
 * already decided the caller may see it.
 *
 * Select strings are single literals — Supabase infers the row shape from the
 * literal type, and concatenation widens it to `string`.
 */
const LIST_COLUMNS =
  'id, candidate_id, company_name, position_title, job_location, application_date, status, source_type, is_verified';

const DETAIL_COLUMNS =
  'id, candidate_id, business_unit_id, company_name, position_title, job_id, job_url, job_location, application_date, status, notes, source_type, source_reference, is_verified, responsible_recruiter_id, created_by, created_at, updated_at';

type CandidateLabel = { name: string; reference: string };

async function candidateLabels(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  ids: string[],
): Promise<Map<string, CandidateLabel>> {
  const labels = new Map<string, CandidateLabel>();
  if (ids.length === 0) return labels;

  const { data } = await supabase
    .from('candidates')
    .select('id, full_name, reference')
    .in('id', ids);

  for (const c of data ?? []) {
    labels.set(c.id, { name: c.full_name, reference: c.reference });
  }
  return labels;
}

export async function listApplications(
  params: ApplicationListParams,
): Promise<ApplicationListItem[]> {
  const supabase = await createServerSupabase();

  let query = supabase.from('applications').select(LIST_COLUMNS);

  if (params.candidateId) query = query.eq('candidate_id', params.candidateId);
  if (params.status) query = query.eq('status', params.status);
  if (params.search) {
    const term = params.search.replace(/[(),]/g, ' ').trim();
    if (term) {
      query = query.or(
        `company_name.ilike.%${term}%,position_title.ilike.%${term}%,job_id.ilike.%${term}%`,
      );
    }
  }

  const { data, error } = await query
    .order('application_date', { ascending: false })
    .order('id', { ascending: true })
    .limit(params.limit);

  if (error) throw error;

  const rows = data ?? [];
  const labels = await candidateLabels(
    supabase,
    [...new Set(rows.map((r) => r.candidate_id))],
  );

  return rows.map((r) => ({
    id: r.id,
    candidateId: r.candidate_id,
    candidateName: labels.get(r.candidate_id)?.name ?? 'Unknown candidate',
    candidateReference: labels.get(r.candidate_id)?.reference ?? '—',
    companyName: r.company_name,
    positionTitle: r.position_title,
    jobLocation: r.job_location,
    applicationDate: r.application_date,
    status: r.status as ApplicationStatus,
    sourceType: r.source_type as SourceKind,
    isVerified: r.is_verified,
  }));
}

export async function getApplication(applicationId: string): Promise<ApplicationDetail> {
  const supabase = await createServerSupabase();

  const { data: app, error } = await supabase
    .from('applications')
    .select(DETAIL_COLUMNS)
    .eq('id', applicationId)
    .maybeSingle();

  if (error) throw error;

  // RLS filtered it out, or it does not exist. The two are deliberately
  // indistinguishable — FORBIDDEN would confirm the record exists.
  if (!app) throw new AppError('NOT_FOUND', 'Application not found.');

  const [labels, historyResult] = await Promise.all([
    candidateLabels(supabase, [app.candidate_id]),
    supabase
      .from('application_status_history')
      .select('id, from_status, to_status, changed_at, changed_by, source_type, note')
      .eq('application_id', applicationId)
      .order('changed_at', { ascending: false }),
  ]);

  const history = historyResult.data ?? [];
  // The responsible recruiter is resolved here alongside the actors, because
  // the two are shown together and the page must be able to say which is which.
  const actorIds = [
    ...new Set(
      [...history.map((h) => h.changed_by), app.created_by, app.responsible_recruiter_id].filter(
        Boolean,
      ),
    ),
  ] as string[];

  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', actorIds);
    for (const u of users ?? []) names.set(u.id, u.full_name);
  }

  const label = labels.get(app.candidate_id);

  return {
    id: app.id,
    candidateId: app.candidate_id,
    candidateName: label?.name ?? 'Unknown candidate',
    candidateReference: label?.reference ?? '—',
    businessUnitId: app.business_unit_id,
    companyName: app.company_name,
    positionTitle: app.position_title,
    jobId: app.job_id,
    jobUrl: app.job_url,
    jobLocation: app.job_location,
    applicationDate: app.application_date,
    status: app.status as ApplicationStatus,
    notes: app.notes,
    sourceType: app.source_type as SourceKind,
    sourceReference: app.source_reference,
    responsibleRecruiterId: app.responsible_recruiter_id,
    responsibleRecruiterName: app.responsible_recruiter_id
      ? (names.get(app.responsible_recruiter_id) ?? null)
      : null,
    isVerified: app.is_verified,
    createdByName: app.created_by ? (names.get(app.created_by) ?? null) : null,
    createdAt: app.created_at,
    updatedAt: app.updated_at,
    statusHistory: history.map((h) => ({
      id: h.id,
      fromStatus: h.from_status as ApplicationStatus | null,
      toStatus: h.to_status as ApplicationStatus,
      changedAt: h.changed_at,
      changedByName: h.changed_by ? (names.get(h.changed_by) ?? null) : null,
      sourceType: h.source_type as SourceKind,
      note: h.note,
    })),
  };
}
