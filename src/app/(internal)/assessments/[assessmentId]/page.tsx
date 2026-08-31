import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireInternal, can } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getAssessment } from '@/server/modules/assessments/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { AssessmentStatusBadge, SourceBadge } from '@/components/patterns/status-badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import { AssessmentOutcomePanel } from './assessment-panels';

export const metadata: Metadata = { title: 'Assessment' };

export default async function AssessmentDetailPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const actor = await requireInternal();
  const { assessmentId } = await params;

  let assessment;
  try {
    assessment = await getAssessment(assessmentId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const canManage = can(actor, 'assessment.manage');

  const facts: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Candidate',
      value: (
        <Link
          href={`/candidates/${assessment.candidateId}`}
          className="hover:text-[var(--color-accent-600)] hover:underline"
        >
          {assessment.candidateName} · {assessment.candidateReference}
        </Link>
      ),
    },
    {
      label: 'Application',
      value: (
        <Link
          href={`/applications/${assessment.applicationId}`}
          className="hover:text-[var(--color-accent-600)] hover:underline"
        >
          {assessment.positionTitle} at {assessment.companyName}
        </Link>
      ),
    },
    { label: 'Received', value: <span className="tabular">{formatDateTime(assessment.receivedAt)}</span> },
    {
      label: 'Deadline',
      value: assessment.deadline ? (
        <span className="tabular">
          {formatDateTime(assessment.deadline)}
          <span
            className={
              assessment.isOverdue
                ? 'ml-2 font-medium text-[var(--color-critical)]'
                : 'ml-2 text-[var(--text-muted)]'
            }
          >
            {assessment.isOverdue ? 'Overdue' : formatRelative(assessment.deadline)}
          </span>
        </span>
      ) : (
        'None given'
      ),
    },
    {
      label: 'Completed',
      value: assessment.completedAt ? (
        <span className="tabular">{formatDateTime(assessment.completedAt)}</span>
      ) : (
        'Not yet'
      ),
    },
    { label: 'Outcome', value: assessment.outcome ?? 'Not recorded' },
    {
      label: 'Assessment link',
      value: assessment.assessmentUrl ? (
        <a
          href={assessment.assessmentUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="break-all text-[var(--color-accent-600)] hover:underline"
        >
          {assessment.assessmentUrl}
        </a>
      ) : (
        'Not recorded'
      ),
    },
    { label: 'Recorded by', value: assessment.createdByName ?? 'System' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={assessment.assessmentType}
        description={`${assessment.candidateName} · ${assessment.positionTitle} at ${assessment.companyName}`}
        actions={
          canManage ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/assessments/${assessment.id}/edit`}>Edit details</Link>
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Assessment</CardTitle>
            <span className="flex items-center gap-1.5">
              <AssessmentStatusBadge status={assessment.status} />
              <SourceBadge source={assessment.sourceType} isVerified={assessment.isVerified} />
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

            {assessment.notes ? (
              <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  Internal notes
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[14px] text-[var(--text-secondary)]">
                  {assessment.notes}
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Status and outcome</CardTitle>
            </CardHeader>
            <CardBody>
              <AssessmentOutcomePanel
                assessmentId={assessment.id}
                currentStatus={assessment.status}
                currentOutcome={assessment.outcome}
              />
              <p className="mt-3 text-[12px] text-[var(--text-muted)]">
                The completion time is set by the system when the status moves to a closed one. It
                is not typed in.
              </p>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
