import type { Metadata } from 'next';
import { requireInternal, can } from '@/server/auth/actor';
import { getCandidate } from '@/server/modules/candidates/queries';
import { listCandidateActivities } from '@/server/modules/activities/queries';
import { listApplications } from '@/server/modules/applications/queries';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { MarketingStatusBadge, ActivityTypeBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { formatDate, formatDateTime } from '@/lib/utils/format';
import { LogActivityForm } from './log-activity-form';

export const metadata: Metadata = { title: 'Candidate marketing' };

export default async function CandidateMarketingPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const actor = await requireInternal();
  const { candidateId } = await params;

  const [candidate, activities, applications] = await Promise.all([
    getCandidate(candidateId),
    listCandidateActivities(candidateId, 100),
    listApplications({ candidateId, limit: 100 }),
  ]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Marketing activity</CardTitle>
          </CardHeader>
          <CardBody>
            {activities.length === 0 ? (
              <EmptyState
                title="No activity recorded"
                body="Applications create activity automatically. Anything else — a recruiter reply, an interview, an assessment — is recorded here as it happens."
              />
            ) : (
              <ul className="flex flex-col">
                {activities.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-col gap-1 border-b border-[var(--border-subtle)] py-3 last:border-b-0 first:pt-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ActivityTypeBadge type={a.activityType} />
                      {a.visibility === 'internal' ? (
                        <span className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                          Internal
                        </span>
                      ) : null}
                      <span className="tabular ml-auto text-[12px] text-[var(--text-muted)]">
                        {formatDateTime(a.activityDate)}
                      </span>
                    </div>
                    {a.summary ? (
                      <p className="text-[13.5px] text-[var(--text-primary)]">{a.summary}</p>
                    ) : null}
                    {a.note ? (
                      <p className="whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
                        {a.note}
                      </p>
                    ) : null}
                    {a.createdByName ? (
                      <p className="text-[12px] text-[var(--text-muted)]">
                        Recorded by {a.createdByName}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Marketing periods</CardTitle>
          </CardHeader>
          <CardBody>
            {candidate.marketingPeriods.length === 0 ? (
              <p className="text-[13px] text-[var(--text-muted)]">
                No marketing period has been opened for this candidate.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {candidate.marketingPeriods.map((p) => (
                  <li key={p.id} className="flex flex-col gap-1">
                    <span className="tabular text-[13.5px] text-[var(--text-primary)]">
                      {formatDate(p.startsOn)} — {p.endsOn ? formatDate(p.endsOn) : 'ongoing'}
                    </span>
                    <MarketingStatusBadge status={p.status} />
                    {p.objective ? (
                      <span className="text-[12.5px] text-[var(--text-secondary)]">
                        {p.objective}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {can(actor, 'activity.create') ? (
          <LogActivityForm
            candidateId={candidateId}
            applications={applications.map((a) => ({
              id: a.id,
              label: `${a.companyName} — ${a.positionTitle}`,
            }))}
          />
        ) : null}
      </div>
    </div>
  );
}
