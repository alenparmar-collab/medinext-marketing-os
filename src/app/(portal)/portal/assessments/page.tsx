import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { getMyAssessments } from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/patterns/states';
import { AssessmentStatusBadge } from '@/components/patterns/status-badge';
import { formatDateTime, formatRelative } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Assessments' };

export default async function PortalAssessmentsPage() {
  const actor = await requireCandidate();
  const assessments = await getMyAssessments(actor.candidateId);

  const open = assessments.filter((a) => a.isOpen);
  const closed = assessments.filter((a) => !a.isOpen);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Assessments"
        description="Tests and exercises sent to you as part of an application."
      />

      {assessments.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          body="If a company asks you to complete a test, it will appear here with the link and the deadline."
        />
      ) : (
        <>
          {open.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                Waiting on you
              </h2>
              <ul className="flex flex-col gap-3">
                {open.map((a) => {
                  const overdue = a.isOverdue;
                  return (
                    <li key={a.id}>
                      <Card
                        className={
                          overdue
                            ? 'border-[var(--color-critical)]/40'
                            : 'border-[var(--color-accent-600)]/30'
                        }
                      >
                        <CardBody className="flex flex-col gap-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[15px] font-medium text-[var(--text-primary)]">
                                {a.assessmentType}
                              </p>
                              <p className="text-[13.5px] text-[var(--text-secondary)]">
                                {a.companyName}
                                {a.positionTitle ? ` · ${a.positionTitle}` : ''}
                              </p>
                            </div>
                            <AssessmentStatusBadge status={a.status} />
                          </div>

                          <p className="tabular text-[13.5px] text-[var(--text-primary)]">
                            {a.deadline ? (
                              <>
                                Due {formatDateTime(a.deadline)}
                                <span
                                  className={
                                    overdue
                                      ? ' font-medium text-[var(--color-critical)]'
                                      : ' text-[var(--text-muted)]'
                                  }
                                >
                                  {' '}
                                  ({overdue ? 'overdue' : formatRelative(a.deadline)})
                                </span>
                              </>
                            ) : (
                              'No deadline given'
                            )}
                          </p>

                          {a.assessmentUrl ? (
                            <a
                              href={a.assessmentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex h-9 w-fit items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-600)] px-3 text-[13.5px] font-medium text-white transition-colors duration-100 hover:bg-[var(--color-accent-700)]"
                            >
                              Open the assessment
                            </a>
                          ) : (
                            <p className="text-[13px] text-[var(--text-muted)]">
                              Your recruiter will send the link separately.
                            </p>
                          )}
                        </CardBody>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {closed.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Completed</h2>
              <Card>
                <CardBody>
                  <ul className="flex flex-col">
                    {closed.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-3 last:border-b-0 first:pt-0"
                      >
                        <div className="min-w-0">
                          <p className="text-[14px] text-[var(--text-primary)]">
                            {a.assessmentType} · {a.companyName}
                          </p>
                          <p className="tabular text-[12.5px] text-[var(--text-muted)]">
                            {a.completedAt
                              ? `Completed ${formatDateTime(a.completedAt)}`
                              : `Received ${formatDateTime(a.receivedAt)}`}
                            {a.outcome ? ` · ${a.outcome}` : ''}
                          </p>
                        </div>
                        <AssessmentStatusBadge status={a.status} />
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
