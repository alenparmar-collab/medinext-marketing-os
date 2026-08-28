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
