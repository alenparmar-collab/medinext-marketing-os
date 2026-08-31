import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireInternal, can } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getInterview } from '@/server/modules/interviews/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { InterviewStatusBadge, SourceBadge } from '@/components/patterns/status-badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatScheduledTime, formatDateTime, formatRelative } from '@/lib/utils/format';
import { INTERVIEW_STATUS_META } from '@/config/statuses';
import { Attribution } from '@/components/patterns/attribution';
import { ReschedulePanel, InterviewOutcomePanel } from './interview-panels';

export const metadata: Metadata = { title: 'Interview' };

/** Reads the same way the history rows do: what changed, when, and who by. */
function changeSummary(change: {
  changeKind: string;
  previousScheduledAt: string | null;
  previousTimeZone: string | null;
  newScheduledAt: string | null;
  newTimeZone: string | null;
  previousStatus: string | null;
  newStatus: string | null;
}): string {
  if (change.changeKind === 'rescheduled') {
    return `Moved from ${formatScheduledTime(change.previousScheduledAt, change.previousTimeZone)} to ${formatScheduledTime(change.newScheduledAt, change.newTimeZone)}`;
  }
  if (change.changeKind === 'status_changed' && change.newStatus) {
    const from = change.previousStatus
      ? INTERVIEW_STATUS_META[change.previousStatus as keyof typeof INTERVIEW_STATUS_META]?.label
      : null;
    const to = INTERVIEW_STATUS_META[change.newStatus as keyof typeof INTERVIEW_STATUS_META]?.label;
    return from ? `${from} → ${to}` : `Set to ${to}`;
  }
  if (change.changeKind === 'scheduled') {
    return `Scheduled for ${formatScheduledTime(change.newScheduledAt, change.newTimeZone)}`;
  }
  return change.changeKind.replace(/_/g, ' ');
}

export default async function InterviewDetailPage({
  params,
}: {
  params: Promise<{ interviewId: string }>;
}) {
  const actor = await requireInternal();
  const { interviewId } = await params;

  let interview;
  try {
    interview = await getInterview(interviewId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const canManage = can(actor, 'interview.manage');

  const facts: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Candidate',
      value: (
        <Link
          href={`/candidates/${interview.candidateId}`}
          className="hover:text-[var(--color-accent-600)] hover:underline"
        >
          {interview.candidateName} · {interview.candidateReference}
        </Link>
      ),
    },
    {
      label: 'Application',
      value: (
        <Link
          href={`/applications/${interview.applicationId}`}
          className="hover:text-[var(--color-accent-600)] hover:underline"
        >
          {interview.positionTitle} at {interview.companyName}
        </Link>
      ),
    },
    { label: 'Round', value: interview.interviewRound },
    {
      label: 'Scheduled',
      value: (
        <span className="tabular">
          {formatScheduledTime(interview.scheduledAt, interview.timeZone)}
          <span className="ml-2 text-[var(--text-muted)]">
            {formatRelative(interview.scheduledAt)}
          </span>
        </span>
      ),
    },
    { label: 'Interviewer', value: interview.interviewerName ?? 'Not recorded' },
    { label: 'Interviewer email', value: interview.interviewerEmail ?? 'Not recorded' },
    {
      label: 'Meeting link',
      value: interview.meetingUrl ? (
        <a
          href={interview.meetingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all text-[var(--color-accent-600)] hover:underline"
        >
          {interview.meetingUrl}
        </a>
      ) : (
        'Not recorded'
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`${interview.positionTitle} at ${interview.companyName}`}
        description={`Round ${interview.interviewRound} · ${interview.candidateName}`}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link href={`/interviews/${interview.id}/edit`}>Edit details</Link>
              </Button>
            </div>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Interview</CardTitle>
              <span className="flex items-center gap-1.5">
                <InterviewStatusBadge status={interview.status} />
                <SourceBadge source={interview.sourceType} isVerified={interview.isVerified} />
              </span>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex flex-col gap-0.5">
                    <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      {fact.label}
                    </dt>
                    <dd className="text-[14px] text-[var(--text-primary)]">{fact.value}</dd>
                  </div>
                ))}
              </dl>

              {/* Whose day this counts towards, and who or what created it. */}
              <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                <Attribution
                  className="grid grid-cols-1 gap-3 sm:grid-cols-3"
                  responsibleRecruiterName={interview.responsibleRecruiterName}
                  createdByName={interview.createdByName}
                  source={interview.sourceType}
                  sourceReference={interview.sourceReference}
                />
              </div>

              {interview.notes ? (
                <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    Internal notes
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] text-[var(--text-secondary)]">
                    {interview.notes}
                  </p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/*
            The schedule history is the record that an interview was moved, and
            it is written by a database trigger rather than by this page. It is
            append-only: nothing here edits or removes a row.
          */}
          <Card>
            <CardHeader>
              <CardTitle>Schedule history</CardTitle>
              <span className="text-[13px] text-[var(--text-muted)]">
                {interview.history.length} {interview.history.length === 1 ? 'change' : 'changes'}
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {interview.history.length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-[var(--text-muted)]">
                  No changes recorded yet.
                </p>
              ) : (
                <ol className="flex flex-col">
                  {interview.history.map((change) => (
                    <li
                      key={change.id}
                      className="border-b border-[var(--border-subtle)] px-5 py-3 last:border-b-0"
                    >
                      <p className="text-[13.5px] text-[var(--text-primary)]">
                        {changeSummary(change)}
                      </p>
                      <p className="tabular mt-0.5 text-[12px] text-[var(--text-muted)]">
                        {formatDateTime(change.changedAt)}
                        {change.changedByName ? ` · ${change.changedByName}` : ' · System'}
                      </p>
                      {change.reason ? (
                        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                          {change.reason}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        {canManage ? (
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Reschedule</CardTitle>
              </CardHeader>
              <CardBody>
                <ReschedulePanel
                  interviewId={interview.id}
                  currentTimeZone={interview.timeZone}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Outcome</CardTitle>
              </CardHeader>
              <CardBody>
                <InterviewOutcomePanel
                  interviewId={interview.id}
                  currentStatus={interview.status}
                />
              </CardBody>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
