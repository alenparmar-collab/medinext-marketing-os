import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type {
  CandidateCounts,
  CandidateDetail,
  CandidateListItem,
  CandidateListPage,
} from './types';
import { EMPTY_COUNTS } from './types';
import type { CandidateListParams } from './schemas';
import type { MarketingStatus, AssignmentType } from '@/config/statuses';

/**
 * Reads run through the user-scoped client, so RLS decides what comes back.
 * There is no application-level filtering by role anywhere in this file — if a
 * row arrives, the database has already decided the caller may see it.
 *
 * No query selects `*`. Explicit column lists mean adding a sensitive column is
 * a decision rather than an accident.
 */

const LIST_COLUMNS =
  'id, reference, full_name, email, primary_skill, current_location, marketing_status, total_experience_months, user_id, archived_at, updated_at';

const DETAIL_COLUMNS =
  'id, business_unit_id, reference, full_name, email, phone, primary_skill, skills, total_experience_months, current_location, visa_status, education, certifications, preferred_locations, marketing_status, user_id, archived_at, created_at, updated_at';

/**
 * Derived counts for a set of candidates, in one round trip.
 *
 * public.candidate_counts is SECURITY INVOKER, so RLS filters it exactly as it
 * would a direct query: a recruiter's figures cover their candidates and a
 * manager's the unit, with no role logic here.
 *
 * Nothing in this product stores a total. Every number on screen traces to the
 * records that produced it.
 */
export async function getCandidateCounts(
  candidateIds: string[],
): Promise<Map<string, CandidateCounts>> {
  const result = new Map<string, CandidateCounts>();
  if (candidateIds.length === 0) return result;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('candidate_counts', {
    p_candidate_ids: candidateIds,
  });

  if (error) throw error;

  for (const row of data ?? []) {
    result.set(row.candidate_id, {
      applications: Number(row.applications),
      recruiterResponses: Number(row.recruiter_responses),
      interviews: Number(row.interviews),
      assessments: Number(row.assessments),
      rejections: Number(row.rejections),
      offers: Number(row.offers),
    });
  }
  return result;
}

/** Active assignee names per candidate, primary recruiter first. */
async function getActiveRecruiters(candidateIds: string[]): Promise<Map<string, string[]>> {
  const byCandidate = new Map<string, string[]>();
  if (candidateIds.length === 0) return byCandidate;

  const supabase = await createServerSupabase();
  const { data: assignments } = await supabase
    .from('candidate_assignments')
    .select('candidate_id, user_id, assignment_type')
    .in('candidate_id', candidateIds)
    .is('ends_on', null);

  const rows = assignments ?? [];
  const userIds = [...new Set(rows.map((a) => a.user_id))];
  if (userIds.length === 0) return byCandidate;

  const { data: users } = await supabase.from('users').select('id, full_name').in('id', userIds);
  const names = new Map((users ?? []).map((u) => [u.id, u.full_name] as const));

  for (const a of rows) {
    const list = byCandidate.get(a.candidate_id) ?? [];
    const name = names.get(a.user_id);
    if (!name) continue;
    if (a.assignment_type === 'primary_recruiter') list.unshift(name);
    else list.push(name);
    byCandidate.set(a.candidate_id, list);
  }
  return byCandidate;
}

export async function listCandidates(params: CandidateListParams): Promise<CandidateListPage> {
  const supabase = await createServerSupabase();

  let query = supabase.from('candidates').select(LIST_COLUMNS);

  if (!params.includeArchived) {
    query = query.is('archived_at', null);
  }
  if (params.status) {
    query = query.eq('marketing_status', params.status);
  }
  if (params.skill) {
    // Matches the primary skill or any entry in the skills array.
    query = query.or(`primary_skill.ilike.%${params.skill.replace(/[(),]/g, ' ')}%`);
  }
  if (params.search) {
    // Escape PostgREST's `or` delimiters before interpolating user input.
    const term = params.search.replace(/[(),]/g, ' ').trim();
    if (term) {
      query = query.or(
        `full_name.ilike.%${term}%,email.ilike.%${term}%,reference.ilike.%${term}%,primary_skill.ilike.%${term}%`,
      );
    }
  }
  if (params.assignedTo) {
    const { data: assigned } = await supabase
      .from('candidate_assignments')
      .select('candidate_id')
      .eq('user_id', params.assignedTo)
      .is('ends_on', null);
    const ids = (assigned ?? []).map((a) => a.candidate_id);
    // An empty assignment list must yield an empty result, not an unfiltered one.
    query = query.in('id', ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000']);
  }

  // Keyset pagination on (full_name, id): OFFSET degrades linearly and, worse,
  // skips and duplicates rows when the data changes between pages — which it
  // constantly will on a board several recruiters are editing at once.
  if (params.cursor) {
    query = query.gt('full_name', params.cursor);
  }

  const { data, error } = await query
    .order('full_name', { ascending: true })
    .order('id', { ascending: true })
    .limit(params.limit + 1);

  if (error) throw error;

  const rows = data ?? [];
  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const ids = page.map((r) => r.id);

  // Two extra round trips for the whole page, not one per row.
  const [counts, recruiters] = await Promise.all([
    getCandidateCounts(ids),
    getActiveRecruiters(ids),
  ]);

  return {
    items: page.map((row) => ({
      ...toListItem(row),
      recruiters: recruiters.get(row.id) ?? [],
      counts: counts.get(row.id) ?? EMPTY_COUNTS,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.full_name ?? null) : null,
  };
}

function toListItem(row: {
  id: string;
  reference: string;
  full_name: string;
  email: string;
  primary_skill: string | null;
  current_location: string | null;
  marketing_status: string;
  total_experience_months: number | null;
  user_id: string | null;
  archived_at: string | null;
  updated_at: string;
}): Omit<CandidateListItem, 'recruiters' | 'counts'> {
  return {
    id: row.id,
    reference: row.reference,
    fullName: row.full_name,
    email: row.email,
    primarySkill: row.primary_skill,
    currentLocation: row.current_location,
    marketingStatus: row.marketing_status as MarketingStatus,
    experienceMonths: row.total_experience_months,
    hasPortalAccess: row.user_id !== null,
    isArchived: row.archived_at !== null,
    updatedAt: row.updated_at,
  };
}

export async function getCandidate(candidateId: string): Promise<CandidateDetail> {
  const supabase = await createServerSupabase();

  const { data: candidate, error } = await supabase
    .from('candidates')
    // Must be a single string literal: Supabase infers the row shape from the
    // literal type, and `'a' + 'b'` widens to `string`, which makes the result
    // type collapse.
    .select(DETAIL_COLUMNS)
    .eq('id', candidateId)
    .maybeSingle();

  if (error) throw error;

  // RLS filtered it out, or it does not exist. We deliberately cannot tell the
  // difference, and neither should the caller: FORBIDDEN would confirm the
  // record exists.
  if (!candidate) throw new AppError('NOT_FOUND', 'Candidate not found.');

  const [assignmentsResult, periodsResult, documentsResult, counts] = await Promise.all([
    supabase
      .from('candidate_assignments')
      .select('id, user_id, assignment_type, starts_on, ends_on, is_active')
      .eq('candidate_id', candidateId)
      .order('starts_on', { ascending: false }),
    supabase
      .from('marketing_periods')
      .select('id, starts_on, ends_on, status, objective')
      .eq('candidate_id', candidateId)
      .order('starts_on', { ascending: false }),
    supabase
      .from('documents')
      .select('id, document_type, file_name, size_bytes, visibility, version, uploaded_at')
      .eq('candidate_id', candidateId)
      .is('deleted_at', null)
      .order('uploaded_at', { ascending: false }),
    getCandidateCounts([candidateId]),
  ]);

  const assignedUserIds = (assignmentsResult.data ?? []).map((a) => a.user_id);
  const namesById = new Map<string, string>();
  if (assignedUserIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', assignedUserIds);
    for (const u of users ?? []) namesById.set(u.id, u.full_name);
  }

  return {
    id: candidate.id,
    businessUnitId: candidate.business_unit_id,
    reference: candidate.reference,
    fullName: candidate.full_name,
    email: candidate.email,
    phone: candidate.phone,
    primarySkill: candidate.primary_skill,
    skills: candidate.skills ?? [],
    experienceMonths: candidate.total_experience_months,
    currentLocation: candidate.current_location,
    visaStatus: candidate.visa_status,
    education: candidate.education,
    certifications: candidate.certifications ?? [],
    preferredLocations: candidate.preferred_locations ?? [],
    marketingStatus: candidate.marketing_status as MarketingStatus,
    hasPortalAccess: candidate.user_id !== null,
    isArchived: candidate.archived_at !== null,
    createdAt: candidate.created_at,
    updatedAt: candidate.updated_at,
    assignments: (assignmentsResult.data ?? []).map((a) => ({
      id: a.id,
      userId: a.user_id,
      userName: namesById.get(a.user_id) ?? 'Unknown user',
      assignmentType: a.assignment_type as AssignmentType,
      startsOn: a.starts_on,
      endsOn: a.ends_on,
      isActive: a.is_active,
    })),
    marketingPeriods: (periodsResult.data ?? []).map((p) => ({
      id: p.id,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      status: p.status as MarketingStatus,
      objective: p.objective,
    })),
    counts: counts.get(candidateId) ?? EMPTY_COUNTS,
    documents: (documentsResult.data ?? []).map((d) => ({
      id: d.id,
      documentType: d.document_type,
      fileName: d.file_name,
      sizeBytes: d.size_bytes,
      visibility: d.visibility,
      version: d.version,
      uploadedAt: d.uploaded_at,
    })),
  };
}
