import { z } from 'zod';
import { uuid, optionalText, requiredText } from '@/lib/validation/primitives';
import { ASSESSMENT_STATUSES } from '@/config/statuses';

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

const optionalDateTime = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .nullable()
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), {
    message: 'Enter a valid date and time',
  });

/** As with interviews, the candidate is derived from the application. */
export const AssessmentCreateSchema = z
  .object({
    applicationId: uuid,
    assessmentType: requiredText('Assessment type', 120),
    assessmentUrl: httpsUrl,
    receivedAt: z
      .string()
      .min(1, 'Received date is required')
      .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date and time' }),
    deadline: optionalDateTime,
    status: z.enum(ASSESSMENT_STATUSES).default('pending'),
    notes: optionalText(2000),
  })
  .refine((v) => !v.deadline || Date.parse(v.deadline) >= Date.parse(v.receivedAt), {
    message: 'The deadline cannot be before the date it was received',
    path: ['deadline'],
  });

export type AssessmentCreateInput = z.infer<typeof AssessmentCreateSchema>;

export const AssessmentUpdateSchema = z.object({
  assessmentId: uuid,
  assessmentType: optionalText(120),
  assessmentUrl: httpsUrl,
  deadline: optionalDateTime,
  notes: optionalText(2000),
});

export type AssessmentUpdateInput = z.infer<typeof AssessmentUpdateSchema>;

export const AssessmentStatusSchema = z.object({
  assessmentId: uuid,
  status: z.enum(ASSESSMENT_STATUSES),
  outcome: optionalText(300),
});

export type AssessmentStatusInput = z.infer<typeof AssessmentStatusSchema>;
