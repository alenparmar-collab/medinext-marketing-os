import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission, can } from '@/server/auth/actor';
import { listTeamMembers } from '@/server/modules/admin/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableWrap, Td, Th, Tr } from '@/components/ui/table';
import { EmptyState } from '@/components/patterns/states';
import { formatRelative } from '@/lib/utils/format';
import { USER_STATUSES, USER_STATUS_META } from '@/config/statuses';
import type { UserAccountStatus } from '@/config/statuses';

export const metadata: Metadata = { title: 'Team' };

/**
 * Internal accounts in the caller's business unit.
 *
 * The unit filter is not applied here — `users_select_colleagues` already
 * restricts the rows, and a second copy of the rule in this file would be a
 * second place for it to go wrong. Portal accounts never appear: the query
 * excludes anything holding the candidate role.
 */
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string }>;
}) {
  const actor = await requirePermission('user.view');
  const filters = await searchParams;

  const status = (USER_STATUSES as readonly string[]).includes(filters.status ?? '')
    ? (filters.status as UserAccountStatus)
    : undefined;

  const members = await listTeamMembers({
    ...(status ? { status } : {}),
    ...(filters.search ? { search: filters.search } : {}),
    limit: 200,
  });

  const canManage = can(actor, 'user.manage');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Team"
        description="Internal accounts in your business unit, the roles they hold, and how many candidates are on each desk."
      />

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          {status || filters.search ? (
            <Link href="/team" className="text-[13px] text-[var(--color-accent-600)] hover:underline">
              Clear
            </Link>
          ) : null}
        </CardHeader>
        <CardBody>
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-3" method="get">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">Search</span>
              <input
                name="search"
                defaultValue={filters.search ?? ''}
                placeholder="Name or email"
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 text-[14px] text-[var(--text-primary)]"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">Status</span>
              <select
                name="status"
                defaultValue={status ?? ''}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 pr-8 text-[14px] text-[var(--text-primary)]"
              >
                <option value="">Any status</option>
                {USER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {USER_STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-[14px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                Apply
              </button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            {members.length} {members.length === 1 ? 'account' : 'accounts'}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {members.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No accounts match"
                body="Internal accounts in your business unit appear here. Candidate portal accounts are not shown — they are not team members."
              />
            </div>
          ) : (
            <TableWrap>
              <Table>
                <caption className="sr-only">Internal accounts</caption>
                <thead>
                  <tr>
                    <Th scope="col">Name</Th>
                    <Th scope="col">Email</Th>
                    <Th scope="col">Roles</Th>
                    <Th scope="col" className="text-right">
                      Candidates
                    </Th>
                    <Th scope="col">Last seen</Th>
                    <Th scope="col">Status</Th>
                    {canManage ? (
                      <Th scope="col">
                        <span className="sr-only">Manage</span>
                      </Th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <Tr key={m.id}>
                      <Td className="font-medium text-[var(--text-primary)]">
                        {m.fullName}
                        {m.id === actor.userId ? (
                          <span className="ml-1.5 text-[12px] font-normal text-[var(--text-muted)]">
                            you
                          </span>
                        ) : null}
                        {m.jobTitle ? (
                          <span className="block text-[12px] font-normal text-[var(--text-muted)]">
                            {m.jobTitle}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="text-[var(--text-secondary)]">{m.email}</Td>
                      <Td className="text-[var(--text-secondary)]">
                        {m.roles.length > 0 ? m.roles.join(', ') : '—'}
                      </Td>
                      <Td className="tabular text-right text-[var(--text-secondary)]">
                        {m.activeAssignments}
                      </Td>
                      <Td className="text-[13px] text-[var(--text-secondary)]">
                        {m.lastSeenAt ? formatRelative(m.lastSeenAt) : 'Never'}
                      </Td>
                      <Td>
                        <Badge tone={USER_STATUS_META[m.status].tone}>
                          {USER_STATUS_META[m.status].label}
                        </Badge>
                      </Td>
                      {canManage ? (
                        <Td className="text-right">
                          <Link
                            href={`/team/${m.id}`}
                            className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                          >
                            Manage
                          </Link>
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
