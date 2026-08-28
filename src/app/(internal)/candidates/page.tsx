import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import { listCandidates } from '@/server/modules/candidates/queries';
import { CandidateListParamsSchema } from '@/server/modules/candidates/schemas';
import { PageHeader } from '@/components/patterns/page-header';
import { MarketingStatusBadge } from '@/components/patterns/status-badge';
import { EmptyState, NoResultsState } from '@/components/patterns/states';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { MARKETING_STATUSES, MARKETING_STATUS_META } from '@/config/statuses';
import { formatExperience } from '@/lib/utils/format';
import { listAssignableUsers } from '@/server/modules/reference/queries';

export const metadata: Metadata = { title: 'Candidates' };

/**
 * Filter state lives in URL search params: shareable links, a working back
 * button, and no client-side filter store to fall out of sync.
 */
export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireInternal();
  const raw = await searchParams;

  // "Mine" is the recruiter's default view: their own book, without having to
  // pick themselves out of a list.
  const mine = raw.mine === '1';

  const params = CandidateListParamsSchema.parse({
    search: typeof raw.q === 'string' ? raw.q : undefined,
    status:
      typeof raw.status === 'string' &&
      (MARKETING_STATUSES as readonly string[]).includes(raw.status)
        ? raw.status
        : undefined,
    skill: typeof raw.skill === 'string' && raw.skill ? raw.skill : undefined,
    assignedTo: mine ? actor.userId : typeof raw.recruiter === 'string' && raw.recruiter ? raw.recruiter : undefined,
    includeArchived: raw.archived === '1',
    cursor: typeof raw.cursor === 'string' ? raw.cursor : undefined,
    limit: 25,
  });

  const [{ items, nextCursor }, recruiterOptions] = await Promise.all([
    listCandidates(params),
    listAssignableUsers(),
  ]);

  const isFiltered = Boolean(
    params.search || params.status || params.skill || params.assignedTo || params.includeArchived,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Candidates"
        description="Everyone you are authorised to see. Recruiters see their assigned candidates; managers see the business unit."
        actions={
          can(actor, 'candidate.create') ? (
            <Button asChild variant="primary" size="sm">
              <Link href="/candidates/new">Add candidate</Link>
            </Button>
          ) : null
        }
      />

      <form className="flex flex-wrap items-end gap-2" role="search">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="q" className="sr-only">
            Search candidates
          </label>
          <Input
            id="q"
            name="q"
            type="search"
            defaultValue={params.search ?? ''}
            placeholder="Search name, email, reference or skill"
          />
        </div>
        <div>
          <label htmlFor="status" className="sr-only">
            Marketing status
          </label>
          <Select id="status" name="status" defaultValue={params.status ?? ''}>
            <option value="">All statuses</option>
            {MARKETING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MARKETING_STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="skill" className="sr-only">
            Skill
          </label>
          <Input
            id="skill"
            name="skill"
            defaultValue={params.skill ?? ''}
            placeholder="Skill"
            className="w-40"
          />
        </div>
        <div>
          <label htmlFor="recruiter" className="sr-only">
            Recruiter
          </label>
          <Select id="recruiter" name="recruiter" defaultValue={mine ? '' : (typeof raw.recruiter === 'string' ? raw.recruiter : '')}>
            <option value="">Any recruiter</option>
            {recruiterOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary" size="md">
          Apply
        </Button>
        <Button asChild variant={mine ? 'primary' : 'ghost'} size="md">
          <Link href={mine ? '/candidates' : '/candidates?mine=1'}>My candidates</Link>
        </Button>
        {isFiltered ? (
          <Button asChild variant="ghost" size="md">
            <Link href="/candidates">Clear</Link>
          </Button>
        ) : null}
      </form>

      {items.length === 0 ? (
        isFiltered ? (
          <NoResultsState
            onClear={
              <Button asChild variant="secondary" size="sm">
                <Link href="/candidates">Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No candidates yet"
            body={
              can(actor, 'candidate.create')
                ? 'Add the first candidate to start tracking their marketing.'
                : 'Candidates assigned to you will appear here once a manager assigns them.'
            }
            action={
              can(actor, 'candidate.create') ? (
                <Button asChild variant="primary" size="sm">
                  <Link href="/candidates/new">Add candidate</Link>
                </Button>
              ) : null
            }
          />
        )
      ) : (
        <>
          <TableWrap>
            <Table>
              <caption className="sr-only">Candidates you can access</caption>
              <thead>
                <tr>
                  <Th scope="col">Candidate</Th>
                  <Th scope="col">Skill</Th>
                  <Th scope="col">Recruiter</Th>
                  <Th scope="col">Marketing status</Th>
                  <Th scope="col" className="text-right">Applications</Th>
                  <Th scope="col" className="text-right">Interviews</Th>
                  <Th scope="col" className="text-right">Assessments</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <Tr key={c.id}>
                    <Td>
                      <Link
                        href={`/candidates/${c.id}`}
                        className="font-medium text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {c.fullName}
                      </Link>
                      {c.isArchived ? (
                        <span className="ml-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                          Archived
                        </span>
                      ) : null}
                      <span className="block font-mono text-[12px] text-[var(--text-muted)]">
                        {c.reference} · {formatExperience(c.experienceMonths)}
                      </span>
                    </Td>
                    <Td className="text-[var(--text-secondary)]">{c.primarySkill ?? '—'}</Td>
                    <Td className="text-[var(--text-secondary)]">
                      {c.recruiters.length > 0 ? (
                        c.recruiters[0]
                      ) : (
                        <span className="text-[var(--text-muted)]">Unassigned</span>
                      )}
                      {c.recruiters.length > 1 ? (
                        <span className="text-[var(--text-muted)]"> +{c.recruiters.length - 1}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <MarketingStatusBadge status={c.marketingStatus} />
                    </Td>
                    {/* Counts are derived from records. Nothing here is stored or typed in. */}
                    <Td className="tabular text-right text-[var(--text-primary)]">
                      {c.counts.applications}
                    </Td>
                    <Td className="tabular text-right text-[var(--text-primary)]">
                      {c.counts.interviews}
                    </Td>
                    <Td className="tabular text-right text-[var(--text-primary)]">
                      {c.counts.assessments}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>

          <div className="flex items-center justify-between">
            <p className="text-[13px] text-[var(--text-muted)]">
              Showing {items.length} candidate{items.length === 1 ? '' : 's'}
            </p>
            {nextCursor ? (
              <Button asChild variant="secondary" size="sm">
                <Link
                  href={{
                    pathname: '/candidates',
                    query: {
                      ...(params.search ? { q: params.search } : {}),
                      ...(params.status ? { status: params.status } : {}),
                      ...(params.skill ? { skill: params.skill } : {}),
                      ...(mine ? { mine: '1' } : {}),
                      cursor: nextCursor,
                    },
                  }}
                >
                  Next page
                </Link>
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
