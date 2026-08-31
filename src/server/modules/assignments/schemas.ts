import { z } from 'zod';
import { uuid, isoDate } from '@/lib/validation/primitives';
import { ASSIGNMENT_TYPES } from '@/config/statuses';

export const AssignmentCreateSchema = z.object({
  candidateId: uuid,
  businessUnitId: uuid,
  userId: uuid,
  assignmentType: z.enum(ASSIGNMENT_TYPES).default('primary_recruiter'),
  startsOn: isoDate.optional(),
});

export type AssignmentCreateInput = z.infer<typeof AssignmentCreateSchema>;

export const AssignmentEndSchema = z.object({
  assignmentId: uuid,
});

export type AssignmentEndInput = z.infer<typeof AssignmentEndSchema>;

/**
 * Reassignment is a single intent, not "end one, create another".
 *
 * Expressing it as one input is what lets it be executed as one transaction
 * (public.reassign_candidate, migration 0029). The alternative leaves a window
 * in which the candidate has nobody working their file.
 */
export const AssignmentTransferSchema = z.object({
  candidateId: uuid,
  userId: uuid,
  assignmentType: z.enum(ASSIGNMENT_TYPES).default('primary_recruiter'),
  startsOn: isoDate.optional(),
});

export type AssignmentTransferInput = z.infer<typeof AssignmentTransferSchema>;
