import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import { listApplications } from '@/server/modules/applications/queries';
import { ApplicationListParamsSchema } from '@/server/modules/applications/schemas';
import { PageHeader } from '@/components/patterns/page-header';
import { ApplicationStatusBadge, SourceBadge } from '@/components/patterns/status-badge';
import { EmptyState, NoResultsState } from '@/components/patterns/states';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { APPLICATION_STATUSES_ORDERED, APPLICATION_STATUS_META } from '@/config/statuses';
import { formatDate } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Applications' };

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireInternal();
  const raw = await searchParams;

  const params = ApplicationListParamsSchema.parse({
    search: typeof raw.q === 'string' ? raw.q : undefined,
    status:
      typeof raw.status === 'string' &&
      (APPLICATION_STATUSES_ORDERED as readonly string[]).includes(raw.status)
        ? raw.status
        : undefined,
    limit: 100,
  });

  const applications = await listApplications(params);
  const isFiltered = Boolean(params.search || params.status);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Applications"
        description="Every application across the candidates you can access, newest first."
        actions={
          can(actor, 'application.create') ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/applications/new">Add application</Link>
            </Button>
          ) : null
        }
      />

      <form className="flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="q" className="sr-only">
            Search applications
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={params.search ?? ''}
            placeholder="Search company, position or job ID"
          />
        </div>
        <div>
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <Select id="status" name="status" defaultValue={params.status ?? ''}>
            <option value="">All statuses</option>
            {APPLICATION_STATUSES_ORDERED.map((s) => (
              <option key={s} value={s}>
                {APPLICATION_STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary" size="md">
          Apply
        </Button>
        {isFiltered ? (
          <Button asChild variant="ghost" size="md">
            <Link href="/applications">Clear</Link>
          </Button>
        ) : null}
      </form>

      {applications.length === 0 ? (
        isFiltered ? (
          <NoResultsState
            onClear={
              <Button asChild variant="secondary" size="sm">
                <Link href="/applications">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No applications yet"
            body="Applications recorded against your candidates will appear here."
          />
        )
      ) : (
        <TableWrap>
          <Table>
            <caption className="sr-only">Applications</caption>
            <thead>
              <tr>
                <Th scope="col">Candidate</Th>
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
                      href={`/candidates/${a.candidateId}`}
                      className="text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                    >
                      {a.candidateName}
                    </Link>
                    <span className="block font-mono text-[12px] text-[var(--text-muted)]">
                      {a.candidateReference}
                    </span>
                  </Td>
                  <Td>
                    <Link
                      href={`/applications/${a.id}`}
                      className="font-medium text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                    >
                      {a.companyName}
                    </Link>
                  </Td>
                  <Td className="text-[var(--text-secondary)]">{a.positionTitle}</Td>
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
      )}
    </div>
  );
}
