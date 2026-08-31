import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type { UserRoleGrantInput, UserStatusInput } from './schemas';

/**
 * Activates, suspends or disables an account.
 *
 * Two guards live here on top of the RLS policy and the 0027 trigger:
 *
 *  - Nobody may change their own account status. An administrator suspending
 *    themselves locks the tenant out of its own administration, and an
 *    administrator RE-activating themselves after being suspended is the
 *    escalation the trigger exists to stop. The trigger already refuses the
 *    second case; refusing both here makes the rule legible.
 *  - Suspension takes effect on the next request without waiting for the JWT
 *    to expire, because `getActor` returns null for any account that is not
 *    active, and every downstream check fails closed on a null actor.
 */
export async function setUserStatus(
  input: UserStatusInput,
  actor: ActorContext,
): Promise<{ id: string; status: string }> {
  if (input.userId === actor.userId) {
    throw new AppError(
      'FORBIDDEN',
      'You cannot change the status of your own account. Ask another administrator.',
    );
  }

  const supabase = await createServerSupabase();

  const { data: target, error: readError } = await supabase
    .from('users')
    .select('id, status')
    .eq('id', input.userId)
    .maybeSingle();

  if (readError) throw readError;
  if (!target) throw new AppError('NOT_FOUND', 'That account is not visible to you.');
  if (target.status === input.status) {
    throw new AppError('CONFLICT', 'That account already has that status.');
  }

  const { data, error } = await supabase
    .from('users')
    .update({ status: input.status })
    .eq('id', input.userId)
    .select('id, status')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'That account is not visible to you, or not permitted.');
  return { id: data.id, status: data.status };
}

/**
 * Grants an internal role.
 *
 * The escalation rules are enforced in the database (0027 refuses an admin
 * grant from a non-admin, 0003 refuses an internal role on a candidate
 * account). They are restated here because a database error reaches the user
 * as "something went wrong", and an administrator who has just been refused
 * deserves to know why.
 *
 * The database remains the authority: removing these checks would change the
 * message, not the outcome.
 */
export async function grantUserRole(
  input: UserRoleGrantInput,
  actor: ActorContext,
): Promise<{ userId: string; role: string }> {
  if (input.role === 'admin' && !actor.roles.includes('admin')) {
    throw new AppError('FORBIDDEN', 'Only an administrator can grant the administrator role.');
  }

  const supabase = await createServerSupabase();

  const { data: existingRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role_code')
    .eq('user_id', input.userId);

  if (rolesError) throw rolesError;
  const codes = (existingRoles ?? []).map((r) => r.role_code);

  if (codes.includes('candidate')) {
    throw new AppError(
      'FORBIDDEN',
      'That is a candidate portal account. A portal account cannot hold an internal role.',
    );
  }
  if (codes.includes(input.role)) {
    throw new AppError('CONFLICT', 'That account already holds that role.');
  }

  const { error } = await supabase
    .from('user_roles')
    .insert({ user_id: input.userId, role_code: input.role, granted_by: actor.userId });

  if (error) throw error;
  return { userId: input.userId, role: input.role };
}

/**
 * Removes an internal role.
 *
 * An account is never left with no role at all: a user with no roles has no
 * permissions and no way back in, which is a deactivation dressed up as a role
 * change. Deactivating an account is a separate, visible action.
 */
export async function revokeUserRole(
  input: UserRoleGrantInput,
  actor: ActorContext,
): Promise<{ userId: string; role: string }> {
  if (input.userId === actor.userId) {
    throw new AppError('FORBIDDEN', 'You cannot change your own roles.');
  }

  const supabase = await createServerSupabase();

  const { data: existingRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('role_code')
    .eq('user_id', input.userId);

  if (rolesError) throw rolesError;
  const codes = (existingRoles ?? []).map((r) => r.role_code);

  if (!codes.includes(input.role)) {
    throw new AppError('CONFLICT', 'That account does not hold that role.');
  }
  if (codes.length === 1) {
    throw new AppError(
      'PRECONDITION_FAILED',
      'That is the only role on the account. Suspend the account instead of leaving it with no role.',
    );
  }

  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', input.userId)
    .eq('role_code', input.role);

  if (error) throw error;
  return { userId: input.userId, role: input.role };
}
