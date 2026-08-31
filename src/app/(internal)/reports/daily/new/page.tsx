import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requirePermission } from '@/server/auth/actor';
import { findOwnReport, getReportMetrics } from '@/server/modules/reports/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/utils/format';
import { MetricFigures } from '../metric-figures';
import { DailyReportForm } from '../daily-report-form';

export const metadata: Metadata = { title: "Today's report" };

export default async function NewDailyReportPage() {
  const actor = await requirePermission('report.submit_own');
  const today = new Date().toISOString().slice(0, 10);

  // If one already exists this is not a new report, and creating a second
  // would hit the unique constraint anyway.
  const existing = await findOwnReport(actor.userId, today);
  if (existing) redirect(`/reports/daily/${existing.id}`);

  const live = await getReportMetrics(actor.userId, today);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title={`Your report for ${formatDate(today)}`}
        description="The figures are already counted. Add what they cannot show."
      />

      <Card>
        <CardHeader>
          <CardTitle>System-calculated</CardTitle>
          <span className="text-[12px] text-[var(--text-muted)]">
            From your records, counted now
          </span>
        </CardHeader>
        <CardBody>
          <MetricFigures metrics={live} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you add</CardTitle>
        </CardHeader>
        <CardBody>
          <DailyReportForm
            reportId={null}
            reportDate={today}
            values={{ notes: null, observations: null, exceptions: null }}
            canConfirm={false}
          />
          <p className="mt-3 text-[12px] text-[var(--text-muted)]">
            Save the draft first. Confirming is available once the report exists, so the figures
            frozen onto it are the ones you looked at.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
