/**
 * The permission catalogue, mirroring supabase/migrations/0012_reference_data.sql.
 *
 * Application code checks CAPABILITIES, never role names. Widening a role is
 * then a seed row rather than a change to every call site.
 *
 * If this list and the database seed ever disagree, the database wins — it is
 * what RLS reads. `npm run test` asserts the two are in sync.
 */
export const PERMISSIONS = [
  'candidate.view_all',
  'candidate.view_assigned',
  'candidate.create',
  'candidate.update',
  'candidate.archive',
  'candidate.delete',
  'candidate.assign',
  'candidate.invite_portal',
  'note.write',
  'marketing_period.view',
  'marketing_period.manage',
  'document.view_internal',
  'document.upload',
  'document.delete',
  'document.set_visibility',
  'user.manage',
  'role.manage',
  'permission.manage',
  'lookup.manage',
  'unit.manage',
  'unit.view_all',
  'audit.read',
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

export const ROLES = ['admin', 'manager', 'recruiter', 'candidate'] as const;
export type RoleCode = (typeof ROLES)[number];

export const INTERNAL_ROLES: readonly RoleCode[] = ['admin', 'manager', 'recruiter'];

export function isInternalRole(role: RoleCode): boolean {
  return INTERNAL_ROLES.includes(role);
}

export const ROLE_LABELS: Record<RoleCode, string> = {
  admin: 'Administrator',
  manager: 'Marketing Manager',
  recruiter: 'Recruiter',
  candidate: 'Candidate',
};
