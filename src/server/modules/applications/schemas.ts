import { z } from 'zod';
import { uuid, isoDate, requiredText, optionalText } from '@/lib/validation/primitives';
import { APPLICATION_STATUSES } from '@/config/statuses';

/**
 * Required: candidate, company, position, application date, status.
 * Optional: job id, job url, job location, notes.
 *
 * job_location is descriptive. It is never compared against the candidate's
 * current or preferred location — there is no mismatch rule in this product.
 */
export const ApplicationCreateSchema = z.object({
  candidateId: uuid,
  marketingPeriodId: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .nullable(),
  companyName: requiredText('Company', 200),
  positionTitle: requiredText('Position', 200),
  applicationDate: isoDate,
  status: z.enum(APPLICATION_STATUSES).default('submitted'),
  jobId: optionalText(80),
  jobUrl: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => v === '' || /^https?:\/\//i.test(v), {
      message: 'Enter a full URL starting with http:// or https://',
    })
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  jobLocation: optionalText(160),
  notes: optionalText(2000),
});

export type ApplicationCreateInput = z.infer<typeof ApplicationCreateSchema>;

export const ApplicationUpdateSchema = ApplicationCreateSchema.partial()
  .omit({ candidateId: true })
  .extend({ applicationId: uuid });

export type ApplicationUpdateInput = z.infer<typeof ApplicationUpdateSchema>;

/**
 * Status change is its own operation rather than a field on the edit form.
 * It is the transition the business cares about, it writes history, and it
 * deserves an explicit action rather than being buried in a save.
 */
export const ApplicationStatusChangeSchema = z.object({
  applicationId: uuid,
  status: z.enum(APPLICATION_STATUSES),
  note: optionalText(500),
});

export type ApplicationStatusChangeInput = z.infer<typeof ApplicationStatusChangeSchema>;

export const ApplicationListParamsSchema = z.object({
  candidateId: uuid.optional(),
  status: z.enum(APPLICATION_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type ApplicationListParams = z.infer<typeof ApplicationListParamsSchema>;
