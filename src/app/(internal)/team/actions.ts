'use server';

import { mutation } from '@/server/auth/mutation';
import { UserStatusSchema, UserRoleGrantSchema } from '@/server/modules/admin/schemas';
import { setUserStatus, grantUserRole, revokeUserRole } from '@/server/modules/admin/commands';

const teamPaths = () => ['/team'];

/**
 * Account status is administration, not self-service.
 *
 * `user.manage` is admin-only, and migration 0027 additionally blocks a user
 * from changing their own status through any path — so a suspended
 * administrator cannot restore themselves even with a direct API call.
 */
export const setUserStatusAction = mutation({
  name: 'user.set_status',
  permission: 'user.manage',
  schema: UserStatusSchema,
  handler: (input, ctx) => setUserStatus(input, ctx),
  revalidate: teamPaths,
});

/**
 * Role grants require `role.manage`, which only an administrator holds. The
 * admin role has a second, structural guard in the database: only an existing
 * administrator can grant it, whatever the permission matrix says.
 */
export const grantUserRoleAction = mutation({
  name: 'user.grant_role',
  permission: 'role.manage',
  schema: UserRoleGrantSchema,
  handler: (input, ctx) => grantUserRole(input, ctx),
  revalidate: teamPaths,
});

export const revokeUserRoleAction = mutation({
  name: 'user.revoke_role',
  permission: 'role.manage',
  schema: UserRoleGrantSchema,
  handler: (input, ctx) => revokeUserRole(input, ctx),
  revalidate: teamPaths,
});
