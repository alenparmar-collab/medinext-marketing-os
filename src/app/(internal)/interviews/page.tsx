import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import { listInterviews } from '@/server/modules/interviews/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { InterviewStatusBadge, SourceBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatScheduledTime, formatRelative } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Interviews' };

export default async function InterviewsPage() {
  const actor = await requireInternal();

  const all = await listInterviews({ limit: 200 });

  // Upcoming first, soonest at the top — that is the question a recruiter
  // actually opens this page to answer. `isUpcoming` is decided in the query
  // layer so no two views can disagree about it.
  const upcoming = all
    .filter((i) => i.isUpcoming)
    .sort((a, b) => Date.parse(a.scheduledAt ?? '') - Date.parse(b.scheduledAt ?? ''));

  const past = all.filter((i) => !i.isUpcoming);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Interviews"
        description="Every interview across the candidates you can access. Upcoming first."
        actions={
          can(actor, 'interview.manage') ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/interviews/new">Schedule interview</Link>
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Upcoming</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            {upcoming.length} scheduled
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {upcoming.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing scheduled"
                body="Interviews you arrange will appear here, soonest first, with the time in your own zone."
              />
            </div>
          ) : (
            <ul className="flex flex-col">
              {upcoming.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--text-primary)]">
                      <Link
                        href={`/interviews/${i.id}`}
                        className="hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {i.positionTitle} · {i.companyName}
                      </Link>
                    </p>
                    <p className="text-[13px] text-[var(--text-secondary)]">
                      <Link
                        href={`/candidates/${i.candidateId}`}
                        className="hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {i.candidateName}
                      </Link>{' '}
                      · round {i.interviewRound}
                      {i.interviewerName ? ` · ${i.interviewerName}` : ''}
                    </p>
                    {/* Never a bare local time: the zone is always labelled. */}
                    <p className="tabular mt-1 text-[13px] text-[var(--text-primary)]">
                      {formatScheduledTime(i.scheduledAt, i.timeZone)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <InterviewStatusBadge status={i.status} />
                    <span className="text-[12px] text-[var(--text-muted)]">
                      {formatRelative(i.scheduledAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {past.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Past and closed</h2>
          <TableWrap>
            <Table>
              <caption className="sr-only">Past interviews</caption>
              <thead>
                <tr>
                  <Th scope="col">Candidate</Th>
                  <Th scope="col">Company</Th>
                  <Th scope="col" className="text-right">Round</Th>
                  <Th scope="col">When</Th>
                  <Th scope="col">Status</Th>
                  <Th scope="col"><span className="sr-only">Open</span></Th>
                </tr>
              </thead>
              <tbody>
                {past.map((i) => (
                  <Tr key={i.id}>
                    <Td>
                      <Link
                        href={`/candidates/${i.candidateId}`}
                        className="text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {i.candidateName}
                      </Link>
                    </Td>
                    <Td className="text-[var(--text-secondary)]">{i.companyName}</Td>
                    <Td className="tabular text-right text-[var(--text-secondary)]">
                      {i.interviewRound}
                    </Td>
                    <Td className="tabular text-[13px] text-[var(--text-secondary)]">
                      {formatScheduledTime(i.scheduledAt, i.timeZone)}
                    </Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <InterviewStatusBadge status={i.status} />
                        <SourceBadge source={i.sourceType} isVerified={i.isVerified} />
                      </span>
                    </Td>
                    <Td className="text-right">
                      <Link
                        href={`/interviews/${i.id}`}
                        className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                      >
                        Open
                      </Link>
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
