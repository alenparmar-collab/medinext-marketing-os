import { z } from 'zod';
import { uuid, optionalText } from '@/lib/validation/primitives';
import { USER_STATUSES } from '@/config/statuses';
import { ROLES, ASSIGNABLE_ROLES } from '@/config/permissions';

/**
 * Administration is deliberately narrow.
 *
 * The brief allows viewing accounts, activating and deactivating them, and
 * seeing roles. It explicitly forbids arbitrary role escalation, so the role
 * schema refuses `candidate` outright: a portal account exists because a
 * candidate record invited it, never because somebody picked the role from a
 * dropdown. The candidate-role exclusivity trigger from 0003 would reject it
 * anyway; refusing here gives the administrator a sentence instead of a
 * database error.
 */
export const UserListParamsSchema = z.object({
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(ROLES).optional(),
  search: optionalText(100),
  limit: z.number().int().min(1).max(200).default(100),
});

export type UserListParams = z.infer<typeof UserListParamsSchema>;

export const UserStatusSchema = z.object({
  userId: uuid,
  // `invited` is set by the invitation flow, not by this screen.
  status: z.enum(['active', 'suspended', 'disabled']),
});

export type UserStatusInput = z.infer<typeof UserStatusSchema>;

export const UserRoleGrantSchema = z.object({
  userId: uuid,
  role: z.enum(ASSIGNABLE_ROLES),
});

export type UserRoleGrantInput = z.infer<typeof UserRoleGrantSchema>;
