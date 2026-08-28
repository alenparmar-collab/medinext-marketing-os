import { z } from 'zod';
import { uuid, optionalText, requiredText } from '@/lib/validation/primitives';
import { MANUAL_ACTIVITY_TYPES } from '@/config/statuses';

/**
 * Only manually loggable types are accepted.
 *
 * application_submitted and status_change are excluded on purpose: the database
 * writes those automatically. Allowing them here would let someone log an
 * application that does not exist, and the derived counts would stop matching
 * the records they are supposed to count.
 */
const manualActivityType = z.enum(
  MANUAL_ACTIVITY_TYPES as unknown as [string, ...string[]],
);

export const ActivityCreateSchema = z.object({
  candidateId: uuid,
  applicationId: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .nullable(),
  activityType: manualActivityType,
  activityDate: z
    .string()
    .min(1, 'Date is required')
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Enter a valid date and time' }),
  summary: requiredText('Summary', 300),
  note: optionalText(2000),
});

export type ActivityCreateInput = z.infer<typeof ActivityCreateSchema>;

export const ActivityListParamsSchema = z.object({
  candidateId: uuid,
  limit: z.number().int().min(1).max(200).default(100),
});

export type ActivityListParams = z.infer<typeof ActivityListParamsSchema>;
