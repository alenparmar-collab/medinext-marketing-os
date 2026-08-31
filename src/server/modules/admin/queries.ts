import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { RoleCode } from '@/config/permissions';
import type { UserAccountStatus } from '@/config/statuses';
import type { UserListParams } from './schemas';

export interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  status: UserAccountStatus;
  roles: RoleCode[];
  /** Candidates currently on this person's desk. Ended assignments do not count. */
  activeAssignments: number;
  lastSeenAt: string | null;
  createdAt: string;
}

// One literal. Concatenating select strings widens them to `string`, and the
// row type collapses with it.
const USER_COLUMNS =
  'id, full_name, email, job_title, status, last_seen_at, created_at, business_unit_id';

/**
 * Lists the accounts the caller may see.
 *
 * The business-unit filter is NOT applied here: `users_select_colleagues`
 * already restricts the result to the caller's unit, and repeating the rule in
 * the query would create a second place for it to drift. Portal accounts are
 * excluded by role, not by a flag — the roles table is the only thing that
 * actually decides what an account is.
 */
export async function listTeamMembers(params: UserListParams): Promise<TeamMember[]> {
  const supabase = await createServerSupabase();

  let query = supabase.from('users').select(USER_COLUMNS);
  if (params.status) query = query.eq('status', params.status);
  if (params.search) {
    const term = `%${params.search}%`;
    query = query.or(`full_name.ilike.${term},email.ilike.${term}`);
  }

  const { data, error } = await query.order('full_name').limit(params.limit);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [rolesResult, assignmentsResult] = await Promise.all([
    supabase.from('user_roles').select('user_id, role_code').in('user_id', ids),
    supabase
      .from('candidate_assignments')
      .select('user_id, candidate_id')
      .in('user_id', ids)
      .is('ends_on', null),
  ]);

  const rolesByUser = new Map<string, RoleCode[]>();
  for (const row of rolesResult.data ?? []) {
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row.role_code as RoleCode);
    rolesByUser.set(row.user_id, list);
  }

  const assignmentCounts = new Map<string, number>();
  for (const row of assignmentsResult.data ?? []) {
    assignmentCounts.set(row.user_id, (assignmentCounts.get(row.user_id) ?? 0) + 1);
  }

  const members = rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    jobTitle: row.job_title,
    status: row.status as UserAccountStatus,
    roles: rolesByUser.get(row.id) ?? [],
    activeAssignments: assignmentCounts.get(row.id) ?? 0,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  }));

  // Portal accounts are not team members. Filtering after the role lookup
  // rather than in SQL keeps one rule about what "internal" means.
  const internal = members.filter((m) => !m.roles.includes('candidate'));

  if (params.role) return internal.filter((m) => m.roles.includes(params.role as RoleCode));
  return internal;
}

export async function getTeamMember(userId: string): Promise<TeamMember> {
  const members = await listTeamMembers({ limit: 200 });
  const member = members.find((m) => m.id === userId);
  if (!member) throw new AppError('NOT_FOUND', 'That account is not visible to you.');
  return member;
}

export interface AssignableUser {
  id: string;
  fullName: string;
  jobTitle: string | null;
  roles: RoleCode[];
  activeAssignments: number;
}

/**
 * The people who may legitimately appear in an assignment dropdown.
 *
 * Suspended and disabled accounts are excluded, as are portal accounts —
 * migration 0027 rejects a candidate account as an assignee outright, and an
 * option that always errors is not an option.
 */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const members = await listTeamMembers({ status: 'active', limit: 200 });
  return members
    .filter((m) => m.roles.some((r) => r === 'admin' || r === 'manager' || r === 'recruiter'))
    .map((m) => ({
      id: m.id,
      fullName: m.fullName,
      jobTitle: m.jobTitle,
      roles: m.roles,
      activeAssignments: m.activeAssignments,
    }));
}
