import { redirect } from 'next/navigation';
import { requirePermission } from '@/server/auth/actor';
import { findOwnReport } from '@/server/modules/reports/queries';

/**
 * A stable entry point for "my report for today".
 *
 * Redirects to the existing report if there is one, and otherwise to the draft
 * editor. Keeping the date server-side means the report is dated by the server
 * clock rather than by whatever the browser thinks the date is.
 */
export default async function TodayReportPage() {
  const actor = await requirePermission('report.submit_own');
  const today = new Date().toISOString().slice(0, 10);

  const existing = await findOwnReport(actor.userId, today);
  if (existing) redirect(`/reports/daily/${existing.id}`);
  redirect('/reports/daily/new');
}
