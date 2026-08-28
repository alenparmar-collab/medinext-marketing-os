import { cache } from 'react';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from './errors';
import type { PermissionCode, RoleCode } from '@/config/permissions';
import { INTERNAL_ROLES } from '@/config/permissions';

/**
 * Everything the server needs to know about who is acting.
 *
 * Passed explicitly rather than read from a global: it makes each command's
 * dependencies visible in its signature and makes commands testable with a
 * fabricated actor.
 */
export interface ActorContext {
  userId: string;
  email: string;
  fullName: string;
  businessUnitId: string | null;
  roles: RoleCode[];
  permissions: ReadonlySet<PermissionCode>;
  /** Set only for portal users. Null for internal staff. */
  candidateId: string | null;
  isInternal: boolean;
  isCandidate: boolean;
}

/**
 * Resolves the actor for this request.
 *
 * Deliberately reads permissions FROM THE TABLES rather than from JWT claims.
 * A JWT is a cache, and caches go stale: if an admin revokes a permission, an
 * already-issued token still carries it until refresh. Reading the tables costs
 * one indexed query and removes that window entirely
 * (docs/architecture/03 §5).
 *
 * Wrapped in React `cache()` so it runs once per request, not once per caller.
 * That cache is request-scoped — it must never be the global data cache, which
 * would serve one user's context to another.
 */
export const getActor = cache(async (): Promise<ActorContext | null> => {
  const supabase = await createServerSupabase();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) return null;

  const [profileResult, rolesResult, candidateResult] = await Promise.all([
    supabase
      .from('users')
      .select('id, email, full_name, business_unit_id, status')
      .eq('id', user.id)
      .maybeSingle(),
    supabase.from('user_roles').select('role_code').eq('user_id', user.id),
    supabase.from('candidates').select('id').eq('user_id', user.id).maybeSingle(),
  ]);

  const profile = profileResult.data;

  // An auth identity with no profile row, or a suspended one, is not an actor.
  // Returning null rather than a partial context means every downstream check
  // fails closed.
  if (!profile || profile.status !== 'active') return null;

  const roles = (rolesResult.data ?? []).map((r) => r.role_code as RoleCode);

  // A user with no roles has no permissions; skip the round trip rather than
  // querying with a sentinel value.
  const permissions = new Set<PermissionCode>();
  if (roles.length > 0) {
    const { data: permissionRows } = await supabase
      .from('role_permissions')
      .select('permission_code')
      .in('role_code', roles);
    for (const row of permissionRows ?? []) {
      permissions.add(row.permission_code as PermissionCode);
    }
  }

  const isInternal = roles.some((r) => INTERNAL_ROLES.includes(r));

  return {
    userId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    businessUnitId: profile.business_unit_id,
    roles,
    permissions,
    candidateId: candidateResult.data?.id ?? null,
    isInternal,
    isCandidate: roles.includes('candidate'),
  };
});

export async function requireActor(): Promise<ActorContext> {
  const actor = await getActor();
  if (!actor) throw new AppError('UNAUTHENTICATED', 'No active session.');
  return actor;
}

export function can(actor: ActorContext, permission: PermissionCode): boolean {
  return actor.permissions.has(permission);
}

export function canAny(actor: ActorContext, permissions: PermissionCode[]): boolean {
  return permissions.some((p) => actor.permissions.has(p));
}

export async function requirePermission(permission: PermissionCode): Promise<ActorContext> {
  const actor = await requireActor();
  if (!can(actor, permission)) {
    throw new AppError('FORBIDDEN', `Missing permission: ${permission}`);
  }
  return actor;
}

export async function requireInternal(): Promise<ActorContext> {
  const actor = await requireActor();
  if (!actor.isInternal) {
    throw new AppError('FORBIDDEN', 'This area is for internal users.');
  }
  return actor;
}

export async function requireCandidate(): Promise<ActorContext & { candidateId: string }> {
  const actor = await requireActor();
  if (!actor.isCandidate || !actor.candidateId) {
    throw new AppError('FORBIDDEN', 'This area is for candidate portal users.');
  }
  return actor as ActorContext & { candidateId: string };
}
