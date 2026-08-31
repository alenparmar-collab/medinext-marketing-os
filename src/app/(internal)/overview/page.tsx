import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import { getOverviewMetrics, getAttentionQueue } from '@/server/modules/dashboard/queries';
import { InterviewStatusBadge, AssessmentStatusBadge } from '@/components/patterns/status-badge';
import { formatScheduledTime, formatRelative, formatDateTime } from '@/lib/utils/format';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { MarketingStatusBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DAILY_REPORT_METRICS,
  DAILY_REPORT_STATUS_META,
  REVIEW_ITEM_PRIORITY_META,
  REVIEW_ITEM_TYPE_META,
} from '@/config/statuses';

export const metadata: Metadata = { title: 'Overview' };

/**
 * Counts here are RLS-filtered, so a recruiter sees their own book and a
 * manager sees the unit's — with no role branching in this file.
 */
export default async function OverviewPage() {
  const actor = await requireInternal();
  const [metrics, attention] = await Promise.all([
    getOverviewMetrics(actor.userId),
    getAttentionQueue(actor.userId),
  ]);

  const nothingPending =
    attention.upcomingInterviews.length === 0 &&
    attention.openAssessments.length === 0 &&
    attention.overdueAssessments.length === 0;

  // Every figure is counted from records. Nothing here is a stored total, and
  // nobody types these numbers in.
  const tiles = [
    { label: 'Candidates', value: metrics.totalCandidates, hint: 'Visible to you, excluding archived' },
    { label: 'Applications', value: metrics.applications, hint: `${metrics.applicationsLast30Days} in the last 30 days` },
    { label: 'Open applications', value: metrics.openApplications, hint: 'Not rejected, withdrawn or closed' },
    { label: 'Interviews', value: metrics.interviews, hint: 'Recorded across your candidates' },
    { label: 'Live marketing periods', value: metrics.activePeriods, hint: 'Active or ready for marketing' },
    { label: 'Assigned to you', value: metrics.myActiveAssignments, hint: 'Current assignments' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Good to see you, ${actor.fullName.split(' ')[0]}`}
        description="A summary of the candidates and marketing activity you can access."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/candidates">View candidates</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardBody>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {tile.label}
              </p>
              <p className="tabular mt-1.5 text-[26px] font-semibold leading-none text-[var(--text-primary)]">
                {tile.value}
              </p>
              <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">{tile.hint}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/*
        Today, for this person. The five figures are counted from the records
        THEY created today — the same derivation the daily report uses, so the
        number here and the number on the report can never disagree.
      */}
      {can(actor, 'report.submit_own') ? (
        <Card>
          <CardHeader>
            <CardTitle>Your day so far</CardTitle>
            {attention.today.status ? (
              <Badge tone={DAILY_REPORT_STATUS_META[attention.today.status].tone}>
                {DAILY_REPORT_STATUS_META[attention.today.status].label}
              </Badge>
            ) : (
              <Badge tone="muted">No report yet</Badge>
            )}
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {DAILY_REPORT_METRICS.map(({ key, label }) => (
                <div
                  key={key}
                  className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2.5"
                >
                  <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {label}
                  </dt>
                  <dd className="tabular mt-1 text-[22px] font-semibold leading-none text-[var(--text-primary)]">
                    {attention.today.metrics[key]}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button asChild variant="secondary" size="sm">
                <Link href="/reports/daily/today">
                  {attention.today.status === 'confirmed'
                    ? "View today's report"
                    : attention.today.status === 'draft'
                      ? 'Finish your report'
                      : 'Write up your day'}
                </Link>
              </Button>
              <p className="text-[12px] text-[var(--text-muted)]">
                Counted from your records. You are never asked to type these in.
              </p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {attention.openReviewItems.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Waiting for a look</CardTitle>
            <Link
              href="/review"
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              Open the queue
            </Link>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="flex flex-col">
              {attention.openReviewItems.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-[var(--text-primary)]">
                      <Link
                        href={`/review/${item.id}`}
                        className="hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {item.reason}
                      </Link>
                    </p>
                    <p className="text-[12px] text-[var(--text-muted)]">
                      {REVIEW_ITEM_TYPE_META[item.itemType].label}
                      {item.candidateName ? ` · ${item.candidateName}` : ''}
                    </p>
                  </div>
                  <Badge tone={REVIEW_ITEM_PRIORITY_META[item.priority].tone}>
                    {REVIEW_ITEM_PRIORITY_META[item.priority].label}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {/*
        "What needs my attention?" comes before the summary counts, because it
        is the question a recruiter opens this page to answer. Deliberately not
        an analytics dashboard.
      */}
      <Card>
        <CardHeader>
          <CardTitle>Needs your attention</CardTitle>
          {attention.unreadNotifications > 0 ? (
            <Link
              href="/notifications"
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              {attention.unreadNotifications} unread
            </Link>
          ) : null}
        </CardHeader>
        <CardBody>
          {nothingPending ? (
            <EmptyState
              title="Nothing scheduled or outstanding"
              body="Upcoming interviews and open assessments for your candidates will appear here."
            />
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Upcoming interviews
                </h3>
                {attention.upcomingInterviews.length === 0 ? (
                  <p className="text-[13px] text-[var(--text-muted)]">Nothing scheduled.</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {attention.upcomingInterviews.map((i) => (
                      <li key={i.id} className="flex flex-col gap-0.5">
                        <span className="text-[13.5px] text-[var(--text-primary)]">
                          <Link
                            href={`/candidates/${i.candidateId}`}
                            className="font-medium hover:text-[var(--color-accent-600)] hover:underline"
                          >
                            {i.candidateName}
                          </Link>{' '}
                          · {i.companyName}
                        </span>
                        <span className="tabular text-[12.5px] text-[var(--text-secondary)]">
                          {formatScheduledTime(i.scheduledAt, i.timeZone)}
                        </span>
                        <span className="flex items-center gap-2">
                          <InterviewStatusBadge status={i.status} />
                          <span className="text-[12px] text-[var(--text-muted)]">
                            {formatRelative(i.scheduledAt)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Assessments outstanding
                </h3>
                {attention.overdueAssessments.length === 0 &&
                attention.openAssessments.length === 0 ? (
                  <p className="text-[13px] text-[var(--text-muted)]">Nothing outstanding.</p>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {[...attention.overdueAssessments, ...attention.openAssessments].map((a) => {
                      const overdue = attention.overdueAssessments.includes(a);
                      return (
                        <li key={a.id} className="flex flex-col gap-0.5">
                          <span className="text-[13.5px] text-[var(--text-primary)]">
                            <Link
                              href={`/candidates/${a.candidateId}`}
                              className="font-medium hover:text-[var(--color-accent-600)] hover:underline"
                            >
                              {a.candidateName}
                            </Link>{' '}
                            · {a.assessmentType}
                          </span>
                          <span className="tabular text-[12.5px] text-[var(--text-secondary)]">
                            {a.deadline ? formatDateTime(a.deadline) : 'No deadline given'}
                          </span>
                          <span className="flex items-center gap-2">
                            <AssessmentStatusBadge status={a.status} />
                            {overdue ? (
                              <span className="text-[12px] font-medium text-[var(--color-critical)]">
                                Overdue
                              </span>
                            ) : a.deadline ? (
                              <span className="text-[12px] text-[var(--text-muted)]">
                                Due {formatRelative(a.deadline)}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Candidates by marketing status</CardTitle>
        </CardHeader>
        <CardBody>
          {metrics.byStatus.length === 0 ? (
            <EmptyState
              title="No candidates yet"
              body="Candidates you can access will be summarised here. A manager or administrator adds the first one."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {metrics.byStatus.map(({ status, count }) => (
                <li
                  key={status}
                  className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 last:border-b-0 last:pb-0"
                >
                  <MarketingStatusBadge status={status} />
                  <span className="tabular text-[14px] font-medium text-[var(--text-primary)]">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
