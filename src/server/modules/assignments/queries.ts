import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { AssignmentType } from '@/config/statuses';

export interface AssignmentRecord {
  id: string;
  candidateId: string;
  candidateName: string | null;
  userId: string;
  userName: string | null;
  assignmentType: AssignmentType;
  startsOn: string;
  endsOn: string | null;
  isActive: boolean;
  createdByName: string | null;
  endedByName: string | null;
  createdAt: string;
}

const COLUMNS =
  'id, candidate_id, user_id, assignment_type, starts_on, ends_on, is_active, created_by, ended_by, created_at';

type Row = {
  id: string;
  candidate_id: string;
  user_id: string;
  assignment_type: AssignmentType;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  created_by: string | null;
  ended_by: string | null;
  created_at: string;
};

async function decorate(rows: Row[]): Promise<AssignmentRecord[]> {
  if (rows.length === 0) return [];
  const supabase = await createServerSupabase();

  const userIds = [
    ...new Set(rows.flatMap((r) => [r.user_id, r.created_by, r.ended_by]).filter(Boolean)),
  ] as string[];
  const candidateIds = [...new Set(rows.map((r) => r.candidate_id))];

  const [users, candidates] = await Promise.all([
    supabase.from('users').select('id, full_name').in('id', userIds),
    supabase.from('candidates').select('id, full_name').in('id', candidateIds),
  ]);

  const userNames = new Map((users.data ?? []).map((u) => [u.id, u.full_name] as const));
  const candidateNames = new Map((candidates.data ?? []).map((c) => [c.id, c.full_name] as const));

  return rows.map((r) => ({
    id: r.id,
    candidateId: r.candidate_id,
    candidateName: candidateNames.get(r.candidate_id) ?? null,
    userId: r.user_id,
    userName: userNames.get(r.user_id) ?? null,
    assignmentType: r.assignment_type,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    isActive: r.is_active,
    createdByName: r.created_by ? (userNames.get(r.created_by) ?? null) : null,
    endedByName: r.ended_by ? (userNames.get(r.ended_by) ?? null) : null,
    createdAt: r.created_at,
  }));
}

/**
 * The full assignment history for one candidate, current first.
 *
 * Ended rows are included on purpose. They are the record of who was
 * accountable for this candidate on any given date, which is the whole reason
 * assignments are stored as a history rather than a column on the candidate.
 */
export async function listCandidateAssignments(candidateId: string): Promise<AssignmentRecord[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidate_assignments')
    .select(COLUMNS)
    .eq('candidate_id', candidateId)
    .order('ends_on', { ascending: true, nullsFirst: true })
    .order('starts_on', { ascending: false });

  if (error) throw error;
  return decorate((data ?? []) as Row[]);
}

/** Active assignments for one internal user — their current desk. */
export async function listAssignmentsForUser(userId: string): Promise<AssignmentRecord[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidate_assignments')
    .select(COLUMNS)
    .eq('user_id', userId)
    .is('ends_on', null)
    .order('starts_on', { ascending: false });

  if (error) throw error;
  return decorate((data ?? []) as Row[]);
}
