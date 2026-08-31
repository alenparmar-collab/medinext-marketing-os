import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import {
  listDailyReports,
  findOwnReport,
  getReportMetrics,
} from '@/server/modules/reports/queries';
import { listTeamMembers } from '@/server/modules/admin/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/patterns/states';
import { formatDate } from '@/lib/utils/format';
import { DAILY_REPORT_METRICS, DAILY_REPORT_STATUS_META } from '@/config/statuses';
import { MetricFigures } from './metric-figures';

export const metadata: Metadata = { title: 'Daily Reports' };

/**
 * The daily report list.
 *
 * Every figure on this page is counted from records. There is no input on this
 * screen, or anywhere behind it, that accepts a total.
 */
export default async function DailyReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ recruiterId?: string; from?: string; to?: string }>;
}) {
  const actor = await requireInternal();
  const filters = await searchParams;

  const canViewAll = can(actor, 'report.view_all');
  const today = new Date().toISOString().slice(0, 10);

  const [reports, ownToday, liveToday, colleagues] = await Promise.all([
    listDailyReports({
      ...(filters.recruiterId ? { recruiterId: filters.recruiterId } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      limit: 60,
    }),
    findOwnReport(actor.userId, today),
    getReportMetrics(actor.userId, today),
    canViewAll ? listTeamMembers({ limit: 200 }) : Promise.resolve([]),
  ]);

  const filtered = Boolean(filters.recruiterId || filters.from || filters.to);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Daily reports"
        description="A record of each day's marketing work. The figures are counted from your records; you supply the judgement."
        actions={
          can(actor, 'report.submit_own') ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/reports/daily/today">
                {ownToday ? "Open today's report" : "Start today's report"}
              </Link>
            </Button>
          ) : null
        }
      />

      {can(actor, 'report.submit_own') ? (
        <Card>
          <CardHeader>
            <CardTitle>Today, {formatDate(today)}</CardTitle>
            <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
              System-calculated
            </span>
          </CardHeader>
          <CardBody>
            <MetricFigures metrics={liveToday} />
            <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
              Counted from the records you created today. These move as you work, and are frozen
              when you confirm the report.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {canViewAll ? (
        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
            {filtered ? (
              <Link
                href="/reports/daily"
                className="text-[13px] text-[var(--color-accent-600)] hover:underline"
              >
                Clear
              </Link>
            ) : null}
          </CardHeader>
          <CardBody>
            {/*
              A GET form: the filters end up in the URL, so a manager can send
              somebody the exact view they are looking at.
            */}
            <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" method="get">
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">
                  Recruiter
                </span>
                <select
                  name="recruiterId"
                  defaultValue={filters.recruiterId ?? ''}
                  className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 pr-8 text-[14px] text-[var(--text-primary)]"
                >
                  <option value="">Everyone</option>
                  {colleagues.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">From</span>
                <input
                  type="date"
                  name="from"
                  defaultValue={filters.from ?? ''}
                  className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 text-[14px] text-[var(--text-primary)]"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">To</span>
                <input
                  type="date"
                  name="to"
                  defaultValue={filters.to ?? ''}
                  className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 text-[14px] text-[var(--text-primary)]"
                />
              </label>

              <div className="flex items-end">
                <Button type="submit" variant="secondary" size="md" className="w-full">
                  Apply
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{canViewAll ? 'Reports' : 'Your reports'}</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            {reports.length} {reports.length === 1 ? 'report' : 'reports'}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {reports.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={filtered ? 'No reports match those filters' : 'No reports yet'}
                body={
                  filtered
                    ? 'Try a wider date range, or clear the filters.'
                    : "A report is one working day. Start today's, add your notes, and confirm it when the day is done."
                }
              />
            </div>
          ) : (
            <TableWrap>
              <Table>
                <caption className="sr-only">Daily reports</caption>
                <thead>
                  <tr>
                    <Th scope="col">Date</Th>
                    {canViewAll ? <Th scope="col">Recruiter</Th> : null}
                    {DAILY_REPORT_METRICS.map((m) => (
                      <Th key={m.key} scope="col" className="text-right">
                        {m.label}
                      </Th>
                    ))}
                    <Th scope="col">Status</Th>
                    <Th scope="col">
                      <span className="sr-only">Open</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    // A confirmed report shows what was frozen; a draft shows
                    // what the records say right now. Both come from the same
                    // function, so they are directly comparable.
                    const figures = r.snapshot ?? r.live;
                    return (
                      <Tr key={r.id}>
                        <Td className="tabular whitespace-nowrap">{formatDate(r.reportDate)}</Td>
                        {canViewAll ? (
                          <Td className="text-[var(--text-secondary)]">{r.recruiterName}</Td>
                        ) : null}
                        {DAILY_REPORT_METRICS.map((m) => (
                          <Td key={m.key} className="tabular text-right">
                            {figures[m.key]}
                          </Td>
                        ))}
                        <Td>
                          <Badge tone={DAILY_REPORT_STATUS_META[r.status].tone}>
                            {DAILY_REPORT_STATUS_META[r.status].label}
                          </Badge>
                        </Td>
                        <Td className="text-right">
                          <Link
                            href={`/reports/daily/${r.id}`}
                            className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                          >
                            Open
                          </Link>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
