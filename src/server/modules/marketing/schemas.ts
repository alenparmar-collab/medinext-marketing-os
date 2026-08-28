import { z } from 'zod';
import { uuid, isoDate, optionalText } from '@/lib/validation/primitives';
import { MARKETING_STATUSES } from '@/config/statuses';

export const MarketingPeriodCreateSchema = z
  .object({
    candidateId: uuid,
    businessUnitId: uuid,
    startsOn: isoDate,
    endsOn: isoDate.optional().nullable(),
    status: z.enum(MARKETING_STATUSES).default('onboarding'),
    objective: optionalText(500),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, {
    message: 'The end date cannot be before the start date',
    path: ['endsOn'],
  });

export type MarketingPeriodCreateInput = z.infer<typeof MarketingPeriodCreateSchema>;

export const MarketingPeriodUpdateSchema = z
  .object({
    periodId: uuid,
    endsOn: isoDate.optional().nullable(),
    status: z.enum(MARKETING_STATUSES),
    objective: optionalText(500),
  });

export type MarketingPeriodUpdateInput = z.infer<typeof MarketingPeriodUpdateSchema>;
