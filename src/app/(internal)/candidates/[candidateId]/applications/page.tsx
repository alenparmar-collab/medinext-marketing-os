import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import { listApplications } from '@/server/modules/applications/queries';
import { ApplicationStatusBadge, SourceBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Candidate applications' };

export default async function CandidateApplicationsPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const actor = await requireInternal();
  const { candidateId } = await params;

  const applications = await listApplications({ candidateId, limit: 100 });

  if (applications.length === 0) {
    return (
      <EmptyState
        title="No applications yet"
        body="Applications submitted on this candidate's behalf will be listed here, newest first."
        action={
          can(actor, 'application.create') ? (
            <Button asChild variant="primary" size="sm">
              <Link href={`/applications/new?candidate=${candidateId}`}>Add application</Link>
            </Button>
          ) : null
        }
      />
    );
  }

  return (
    <TableWrap>
      <Table>
        <caption className="sr-only">Applications for this candidate</caption>
        <thead>
          <tr>
            <Th scope="col">Company</Th>
            <Th scope="col">Position</Th>
            <Th scope="col">Location</Th>
            <Th scope="col">Applied</Th>
            <Th scope="col">Status</Th>
          </tr>
        </thead>
        <tbody>
          {applications.map((a) => (
            <Tr key={a.id}>
              <Td>
                <Link
                  href={`/applications/${a.id}`}
                  className="font-medium text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                >
                  {a.companyName}
                </Link>
              </Td>
              <Td className="text-[var(--text-secondary)]">{a.positionTitle}</Td>
              {/* Descriptive only — never compared against candidate location. */}
              <Td className="text-[var(--text-secondary)]">{a.jobLocation ?? '—'}</Td>
              <Td className="tabular text-[var(--text-secondary)]">
                {formatDate(a.applicationDate)}
              </Td>
              <Td>
                <span className="flex flex-wrap items-center gap-1.5">
                  <ApplicationStatusBadge status={a.status} />
                  <SourceBadge source={a.sourceType} isVerified={a.isVerified} />
                </span>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
