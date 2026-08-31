'use server';

import { mutation } from '@/server/auth/mutation';
import {
  DailyReportUpsertSchema,
  DailyReportConfirmSchema,
} from '@/server/modules/reports/schemas';
import { upsertOwnDailyReport, confirmDailyReport } from '@/server/modules/reports/commands';

/**
 * Two actions, and neither accepts a number.
 *
 * The figures on a daily report are counted from the records by
 * public.daily_report_metrics. No action here can set one, because no schema
 * here has a field for one.
 */
const reportPaths = () => ['/reports/daily', '/reports', '/overview'];

export const saveDailyReportAction = mutation({
  name: 'report.save_own',
  permission: 'report.submit_own',
  schema: DailyReportUpsertSchema,
  handler: (input, ctx) => upsertOwnDailyReport(input, ctx),
  revalidate: reportPaths,
});

/**
 * Confirmation freezes the derived figures onto the row. It is a separate
 * action because it is a separate decision: after it, the report is a record
 * rather than a working note, and the numbers stop moving.
 */
export const confirmDailyReportAction = mutation({
  name: 'report.confirm_own',
  permission: 'report.submit_own',
  schema: DailyReportConfirmSchema,
  handler: (input, ctx) => confirmDailyReport(input, ctx),
  revalidate: reportPaths,
});
