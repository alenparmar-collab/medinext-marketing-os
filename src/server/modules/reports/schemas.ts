import { z } from 'zod';
import { uuid, isoDate, optionalText } from '@/lib/validation/primitives';

/**
 * A daily report accepts JUDGEMENT, never figures.
 *
 * There is deliberately no field here for an application count, a response
 * count, or any other number. Those are derived from the records by
 * public.daily_report_metrics and cannot be supplied by a caller — which is
 * the whole point of the design, and is enforced by the schema having nowhere
 * to put them.
 */
export const DailyReportUpsertSchema = z.object({
  reportDate: isoDate,
  notes: optionalText(4000),
  observations: optionalText(4000),
  exceptions: optionalText(4000),
});

export type DailyReportUpsertInput = z.infer<typeof DailyReportUpsertSchema>;

export const DailyReportConfirmSchema = z.object({
  reportId: uuid,
  notes: optionalText(4000),
  observations: optionalText(4000),
  exceptions: optionalText(4000),
});

export type DailyReportConfirmInput = z.infer<typeof DailyReportConfirmSchema>;

export const DailyReportListParamsSchema = z.object({
  recruiterId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.number().int().min(1).max(200).default(60),
});

export type DailyReportListParams = z.infer<typeof DailyReportListParamsSchema>;
