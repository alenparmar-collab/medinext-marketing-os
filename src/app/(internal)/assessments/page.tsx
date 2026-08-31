import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal } from '@/server/auth/actor';
import { listAssessments } from '@/server/modules/assessments/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { AssessmentStatusBadge, SourceBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime, formatRelative } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Assessments' };

export default async function AssessmentsPage() {
  await requireInternal();

  const all = await listAssessments({ limit: 200 });
  const open = all
    .filter((a) => a.isOpen)
    .sort((a, b) => {
      // Soonest deadline first; anything without one sinks to the bottom.
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return Date.parse(a.deadline) - Date.parse(b.deadline);
    });
  const closed = all.filter((a) => !a.isOpen);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Assessments"
        description="Assessments issued to the candidates you can access. Outstanding work first."
      />

      <Card>
        <CardHeader>
          <CardTitle>Outstanding</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">{open.length} open</span>
        </CardHeader>
        <CardBody className="p-0">
          {open.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing outstanding"
                body="Assessments waiting on a candidate appear here, with the nearest deadline first."
              />
            </div>
          ) : (
            <ul className="flex flex-col">
              {open.map((a) => {
                const overdue = a.isOverdue;
                return (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-[var(--text-primary)]">
                        {a.assessmentType} · {a.companyName}
                      </p>
                      <p className="text-[13px] text-[var(--text-secondary)]">
                        <Link
                          href={`/candidates/${a.candidateId}`}
                          className="hover:text-[var(--color-accent-600)] hover:underline"
                        >
                          {a.candidateName}
                        </Link>{' '}
                        · {a.positionTitle}
                      </p>
                      <p className="tabular mt-1 text-[13px] text-[var(--text-secondary)]">
                        {a.deadline ? `Due ${formatDateTime(a.deadline)}` : 'No deadline given'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <AssessmentStatusBadge status={a.status} />
                      {a.deadline ? (
                        <span
                          className={
                            overdue
                              ? 'text-[12px] font-medium text-[var(--color-critical)]'
                              : 'text-[12px] text-[var(--text-muted)]'
                          }
                        >
                          {overdue ? 'Overdue' : `Due ${formatRelative(a.deadline)}`}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {closed.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Closed</h2>
          <TableWrap>
            <Table>
              <caption className="sr-only">Closed assessments</caption>
              <thead>
                <tr>
                  <Th scope="col">Candidate</Th>
                  <Th scope="col">Assessment</Th>
                  <Th scope="col">Company</Th>
                  <Th scope="col">Completed</Th>
                  <Th scope="col">Outcome</Th>
                  <Th scope="col">Status</Th>
                </tr>
              </thead>
              <tbody>
                {closed.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <Link
                        href={`/candidates/${a.candidateId}`}
                        className="text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {a.candidateName}
                      </Link>
                    </Td>
                    <Td className="text-[var(--text-secondary)]">{a.assessmentType}</Td>
                    <Td className="text-[var(--text-secondary)]">{a.companyName}</Td>
                    <Td className="tabular text-[13px] text-[var(--text-secondary)]">
                      {a.completedAt ? formatDateTime(a.completedAt) : '—'}
                    </Td>
                    <Td className="text-[var(--text-secondary)]">{a.outcome ?? '—'}</Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <AssessmentStatusBadge status={a.status} />
                        <SourceBadge source={a.sourceType} isVerified={a.isVerified} />
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </div>
      ) : null}
    </div>
  );
}
