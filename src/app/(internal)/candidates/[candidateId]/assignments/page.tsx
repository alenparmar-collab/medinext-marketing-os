import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireInternal, can } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getCandidate } from '@/server/modules/candidates/queries';
import { listCandidateAssignments } from '@/server/modules/assignments/queries';
import { listAssignableUsers } from '@/server/modules/admin/queries';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/patterns/states';
import { formatDate } from '@/lib/utils/format';
import { ASSIGNMENT_TYPE_LABELS } from '@/config/statuses';
import { AssignForm, EndAssignmentButton } from './assignment-controls';

export const metadata: Metadata = { title: 'Candidate assignments' };

/**
 * Who works this candidate, and who worked them before.
 *
 * Ended assignments stay on the page. "Who owned this candidate when the offer
 * came in" is a question the business actually asks, and an assignment model
 * that overwrites itself cannot answer it.
 */
export default async function CandidateAssignmentsPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const actor = await requireInternal();
  const { candidateId } = await params;

  let candidate;
  try {
    candidate = await getCandidate(candidateId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const canAssign = can(actor, 'candidate.assign');
  const [assignments, assignable] = await Promise.all([
    listCandidateAssignments(candidateId),
    canAssign ? listAssignableUsers() : Promise.resolve([]),
  ]);

  const active = assignments.filter((a) => a.isActive);
  const ended = assignments.filter((a) => !a.isActive);
  const hasPrimary = active.some((a) => a.assignmentType === 'primary_recruiter');

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Currently assigned</CardTitle>
            <span className="tabular text-[13px] text-[var(--text-muted)]">
              {active.length} active
            </span>
          </CardHeader>
          <CardBody className="p-0">
            {active.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="Nobody is assigned"
                  body="Nobody is currently working this candidate. A manager or administrator assigns a recruiter."
                />
              </div>
            ) : (
              <ul className="flex flex-col">
                {active.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-[var(--text-primary)]">
                        <Link
                          href={`/team/${a.userId}`}
                          className="hover:text-[var(--color-accent-600)] hover:underline"
                        >
                          {a.userName ?? 'Unknown user'}
                        </Link>
                      </p>
                      <p className="tabular text-[12.5px] text-[var(--text-muted)]">
                        Since {formatDate(a.startsOn)}
                        {a.createdByName ? ` · assigned by ${a.createdByName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone="info">{ASSIGNMENT_TYPE_LABELS[a.assignmentType]}</Badge>
                      {canAssign ? <EndAssignmentButton assignmentId={a.id} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <span className="tabular text-[13px] text-[var(--text-muted)]">
              {ended.length} ended
            </span>
          </CardHeader>
          <CardBody className="p-0">
            {ended.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-[var(--text-muted)]">
                No assignment has ended yet.
              </p>
            ) : (
              <ul className="flex flex-col">
                {ended.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-[13.5px] text-[var(--text-primary)]">
                        {a.userName ?? 'Unknown user'}
                      </p>
                      <p className="tabular text-[12px] text-[var(--text-muted)]">
                        {formatDate(a.startsOn)} — {a.endsOn ? formatDate(a.endsOn) : '—'}
                        {a.endedByName ? ` · ended by ${a.endedByName}` : ''}
                      </p>
                    </div>
                    <Badge tone="muted">{ASSIGNMENT_TYPE_LABELS[a.assignmentType]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {canAssign ? (
        <Card>
          <CardHeader>
            <CardTitle>{hasPrimary ? 'Change or add' : 'Assign a recruiter'}</CardTitle>
          </CardHeader>
          <CardBody>
            <AssignForm
              candidateId={candidateId}
              businessUnitId={candidate.businessUnitId}
              options={assignable.map((u) => ({
                id: u.id,
                fullName: u.fullName,
                activeAssignments: u.activeAssignments,
              }))}
              hasPrimary={hasPrimary}
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            <p className="text-[13px] text-[var(--text-secondary)]">
              Assignments are changed by a manager or administrator. A recruiter cannot put
              themselves on a candidate.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
