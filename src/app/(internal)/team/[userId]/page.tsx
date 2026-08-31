import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getTeamMember } from '@/server/modules/admin/queries';
import { listAssignmentsForUser } from '@/server/modules/assignments/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime, formatRelative } from '@/lib/utils/format';
import { USER_STATUS_META, ASSIGNMENT_TYPE_LABELS } from '@/config/statuses';
import { AccountStatusControl, RoleControl } from '../team-controls';

export const metadata: Metadata = { title: 'Account' };

export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const actor = await requirePermission('user.view');
  const { userId } = await params;

  let member;
  try {
    member = await getTeamMember(userId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const assignments = await listAssignmentsForUser(member.id);
  const canManageUsers = can(actor, 'user.manage');
  const canManageRoles = can(actor, 'role.manage');
  const isSelf = member.id === actor.userId;

  const facts: { label: string; value: string }[] = [
    { label: 'Email', value: member.email },
    { label: 'Job title', value: member.jobTitle ?? 'Not recorded' },
    { label: 'Roles', value: member.roles.length > 0 ? member.roles.join(', ') : 'None' },
    { label: 'Account created', value: formatDate(member.createdAt) },
    {
      label: 'Last seen',
      value: member.lastSeenAt ? formatDateTime(member.lastSeenAt) : 'Never signed in',
    },
  ];

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={member.fullName}
        description={`${member.activeAssignments} ${member.activeAssignments === 1 ? 'candidate' : 'candidates'} currently assigned`}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/team">All accounts</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <Badge tone={USER_STATUS_META[member.status].tone}>
                {USER_STATUS_META[member.status].label}
              </Badge>
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
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Current desk</CardTitle>
              <span className="tabular text-[13px] text-[var(--text-muted)]">
                {assignments.length} active
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {assignments.length === 0 ? (
                <p className="px-5 py-4 text-[13px] text-[var(--text-muted)]">
                  No candidates are currently assigned to this account.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {assignments.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3 last:border-b-0"
                    >
                      <Link
                        href={`/candidates/${a.candidateId}`}
                        className="text-[13.5px] font-medium text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {a.candidateName ?? 'Candidate'}
                      </Link>
                      <span className="text-[12.5px] text-[var(--text-muted)]">
                        {ASSIGNMENT_TYPE_LABELS[a.assignmentType]} · since{' '}
                        {formatRelative(a.startsOn)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {canManageUsers ? (
            <Card>
              <CardHeader>
                <CardTitle>Account status</CardTitle>
              </CardHeader>
              <CardBody>
                <AccountStatusControl
                  userId={member.id}
                  currentStatus={member.status}
                  isSelf={isSelf}
                />
              </CardBody>
            </Card>
          ) : null}

          {canManageRoles ? (
            <Card>
              <CardHeader>
                <CardTitle>Roles</CardTitle>
              </CardHeader>
              <CardBody>
                <RoleControl
                  userId={member.id}
                  currentRoles={member.roles}
                  actorIsAdmin={actor.roles.includes('admin')}
                  isSelf={isSelf}
                />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Roles are administered by an administrator. Managers run the marketing operation
                  but do not administer accounts.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
