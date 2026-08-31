import { z } from 'zod';
import { uuid, optionalText } from '@/lib/validation/primitives';
import { INTERVIEW_STATUSES } from '@/config/statuses';

const httpsUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || /^https?:\/\//i.test(v), {
    message: 'Enter a full URL starting with http:// or https://',
  })
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const datetimeLocal = z
  .string()
  .min(1, 'Date and time are required')
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date and time' });

/**
 * The candidate is NOT accepted from the caller.
 *
 * It is derived server-side from the application, which is the only safe
 * source: an interview belongs to the candidate that owns the application, and
 * a client-supplied candidate id could only ever agree with that or be an
 * attack. The composite foreign key would reject a mismatch anyway, but not
 * offering the field removes the question.
 */
export const InterviewCreateSchema = z.object({
  applicationId: uuid,
  interviewRound: z.coerce.number().int().min(1).max(20).default(1),
  scheduledAt: datetimeLocal,
  timeZone: optionalText(64),
  meetingUrl: httpsUrl,
  interviewerName: optionalText(160),
  interviewerEmail: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
      message: 'Enter a valid email address',
    })
    .transform((v) => (v === '' ? null : v.toLowerCase()))
    .nullable()
    .optional(),
  status: z.enum(INTERVIEW_STATUSES).default('scheduled'),
  notes: optionalText(2000),
});

export type InterviewCreateInput = z.infer<typeof InterviewCreateSchema>;

export const InterviewUpdateSchema = z.object({
  interviewId: uuid,
  interviewRound: z.coerce.number().int().min(1).max(20).optional(),
  meetingUrl: httpsUrl,
  interviewerName: optionalText(160),
  notes: optionalText(2000),
});

export type InterviewUpdateInput = z.infer<typeof InterviewUpdateSchema>;

/**
 * Rescheduling is its own operation, not a field on the edit form. It writes
 * history and notifies the candidate, so it deserves an explicit action with
 * an explicit reason rather than being buried in a save.
 */
export const InterviewRescheduleSchema = z.object({
  interviewId: uuid,
  scheduledAt: datetimeLocal,
  timeZone: optionalText(64),
  reason: optionalText(500),
});

export type InterviewRescheduleInput = z.infer<typeof InterviewRescheduleSchema>;

export const InterviewStatusSchema = z.object({
  interviewId: uuid,
  status: z.enum(INTERVIEW_STATUSES),
  reason: optionalText(500),
});

export type InterviewStatusInput = z.infer<typeof InterviewStatusSchema>;
