import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireInternal } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getDailyReport } from '@/server/modules/reports/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime } from '@/lib/utils/format';
import { DAILY_REPORT_STATUS_META } from '@/config/statuses';
import { MetricFigures } from '../metric-figures';
import { DailyReportForm } from '../daily-report-form';

export const metadata: Metadata = { title: 'Daily report' };

export default async function DailyReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const actor = await requireInternal();
  const { reportId } = await params;

  let report;
  try {
    report = await getDailyReport(reportId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const isOwn = report.recruiterId === actor.userId;
  const isDraft = report.status === 'draft';
  const canEdit = isOwn && isDraft;

  const judgement: { label: string; value: string | null }[] = [
    { label: 'Notes', value: report.notes },
    { label: 'Observations', value: report.observations },
    { label: 'Exceptions', value: report.exceptions },
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={`${formatDate(report.reportDate)} · ${report.recruiterName}`}
        description={
          isDraft
            ? 'A draft. The figures below are counted from the records right now.'
            : 'Confirmed. The figures below were frozen at the moment of confirmation.'
        }
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/reports/daily">All reports</Link>
          </Button>
        }
      />

      {/*
        The distinction this page exists to make. The system-calculated block
        and the user-entered block are visually separate, labelled, and never
        interleaved — a reader can always tell which half a number came from.
      */}
      <Card>
        <CardHeader>
          <CardTitle>
            {report.snapshot ? 'System-calculated, frozen at confirmation' : 'System-calculated'}
          </CardTitle>
          <Badge tone={DAILY_REPORT_STATUS_META[report.status].tone}>
            {DAILY_REPORT_STATUS_META[report.status].label}
          </Badge>
        </CardHeader>
        <CardBody>
          <MetricFigures
            metrics={report.snapshot ?? report.live}
            compareWith={report.snapshot ? report.live : null}
          />

          <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
            {report.snapshot
              ? `Frozen ${formatDateTime(report.snapshotTakenAt)}${report.confirmedByName ? ` by ${report.confirmedByName}` : ''}. Counted from the records ${report.recruiterName} created on this date — nobody typed them in.`
              : `Counted from the records ${report.recruiterName} created on this date. They will be frozen when the report is confirmed.`}
          </p>

          {report.snapshotDiffers ? (
            <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-caution)]/30 bg-[var(--color-caution-bg)] px-3 py-2.5">
              <p className="text-[13px] font-medium text-[var(--color-caution)]">
                The records have changed since this report was confirmed.
              </p>
              <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
                Both figures are shown. The frozen figures are what was reported on the day; the
                current counts are what the records say now. Neither is edited to match the other.
              </p>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>User-entered</CardTitle>
          <span className="text-[12px] text-[var(--text-muted)]">
            {canEdit ? 'Editable while this report is a draft' : 'Read-only'}
          </span>
        </CardHeader>
        <CardBody>
          {canEdit ? (
            <DailyReportForm
              reportId={report.id}
              reportDate={report.reportDate}
              values={{
                notes: report.notes,
                observations: report.observations,
                exceptions: report.exceptions,
              }}
              canConfirm
            />
          ) : (
            <dl className="flex flex-col gap-4">
              {judgement.map((entry) => (
                <div key={entry.label} className="flex flex-col gap-1">
                  <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {entry.label}
                  </dt>
                  <dd className="whitespace-pre-wrap text-[14px] text-[var(--text-primary)]">
                    {entry.value ?? <span className="text-[var(--text-muted)]">Not recorded</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {!isOwn ? (
            <p className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-[12px] text-[var(--text-muted)]">
              This is {report.recruiterName}&apos;s report. Only its author can edit it, and only
              while it is a draft.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
