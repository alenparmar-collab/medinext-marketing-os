import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/server/auth/actor';
import { getTeamDayOverview } from '@/server/modules/reports/queries';
import { listTeamMembers } from '@/server/modules/admin/queries';
import { countOpenReviewItems } from '@/server/modules/review';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/patterns/states';
import { formatDate } from '@/lib/utils/format';
import { DAILY_REPORT_METRICS, DAILY_REPORT_STATUS_META } from '@/config/statuses';
import { MetricFigures } from './daily/metric-figures';

export const metadata: Metadata = { title: 'Reports' };

/**
 * The manager's workspace: one day, the whole unit.
 *
 * Every number on this page is counted from records — per person by
 * public.daily_report_metrics, then added up. The unit total is the sum of
 * real records rather than a separately maintained figure, so there is nothing
 * here that can disagree with the underlying data.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requirePermission('report.view_all');
  const { date } = await searchParams;

  const today = new Date().toISOString().slice(0, 10);
  // A malformed date in the URL falls back to today rather than erroring: this
  // is a report, and the worst case is showing the wrong day, clearly labelled.
  const reportDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;

  const members = await listTeamMembers({ status: 'active', limit: 200 });
  const recruiters = members.filter((m) =>
    m.roles.some((r) => r === 'recruiter' || r === 'manager' || r === 'admin'),
  );

  const [overview, openReviewItems] = await Promise.all([
    getTeamDayOverview(
      recruiters.map((r) => ({ id: r.id, fullName: r.fullName })),
      reportDate,
    ),
    countOpenReviewItems(),
  ]);

  const submission = [
    { label: 'Confirmed', value: overview.confirmedCount, tone: 'positive' as const },
    { label: 'Draft', value: overview.draftCount, tone: 'caution' as const },
    { label: 'Not started', value: overview.missingCount, tone: 'muted' as const },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="One day across the business unit. Every figure is counted from records — nobody types a total."
        actions={
          <div className="flex flex-wrap gap-2">
            {/* Two different reports, deliberately separate: one a recruiter
                writes and confirms, one derived from the records themselves. */}
            <Button asChild variant="secondary" size="sm">
              <Link href="/reports/operations">Operations day</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/reports/daily">All daily reports</Link>
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{formatDate(overview.reportDate)}</CardTitle>
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="date" className="text-[13px] text-[var(--text-secondary)]">
              Date
            </label>
            <input
              id="date"
              type="date"
              name="date"
              defaultValue={overview.reportDate}
              max={today}
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-[13px] text-[var(--text-primary)]"
            />
            <button
              type="submit"
              className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
            >
              Show
            </button>
          </form>
        </CardHeader>
        <CardBody>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Unit total, system-calculated
          </p>
          <MetricFigures metrics={overview.totals} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        {submission.map((s) => (
          <Card key={s.label}>
            <CardBody>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {s.label}
              </p>
              <p className="tabular mt-1.5 text-[26px] font-semibold leading-none text-[var(--text-primary)]">
                {s.value}
              </p>
            </CardBody>
          </Card>
        ))}
        <Card>
          <CardBody>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Review queue
            </p>
            <p className="tabular mt-1.5 text-[26px] font-semibold leading-none text-[var(--text-primary)]">
              {openReviewItems}
            </p>
            <Link
              href="/review"
              className="mt-1.5 inline-block text-[12px] text-[var(--color-accent-600)] hover:underline"
            >
              Open the queue
            </Link>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By person</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            {overview.rows.length} people
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {overview.rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nobody to report on"
                body="Active internal accounts in your business unit appear here once they exist."
              />
            </div>
          ) : (
            <TableWrap>
              <Table>
                <caption className="sr-only">Activity by person</caption>
                <thead>
                  <tr>
                    <Th scope="col">Person</Th>
                    {DAILY_REPORT_METRICS.map((m) => (
                      <Th key={m.key} scope="col" className="text-right">
                        {m.label}
                      </Th>
                    ))}
                    <Th scope="col">Report</Th>
                  </tr>
                </thead>
                <tbody>
                  {overview.rows.map((row) => (
                    <Tr key={row.recruiterId}>
                      <Td className="font-medium text-[var(--text-primary)]">
                        <Link
                          href={`/reports/daily?recruiterId=${row.recruiterId}`}
                          className="hover:text-[var(--color-accent-600)] hover:underline"
                        >
                          {row.recruiterName}
                        </Link>
                      </Td>
                      {DAILY_REPORT_METRICS.map((m) => (
                        <Td key={m.key} className="tabular text-right">
                          {row.live[m.key]}
                        </Td>
                      ))}
                      <Td>
                        {row.status === null ? (
                          <Badge tone="muted">Not started</Badge>
                        ) : (
                          <Link href={`/reports/daily/${row.reportId}`}>
                            <Badge tone={DAILY_REPORT_STATUS_META[row.status].tone}>
                              {DAILY_REPORT_STATUS_META[row.status].label}
                            </Badge>
                          </Link>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      <p className="text-[12px] text-[var(--text-muted)]">
        A missing report does not mean no work happened — the figures above are counted from the
        records regardless of whether anyone has written the day up. What a report adds is the
        judgement: notes, observations and exceptions.
      </p>
    </div>
  );
}
