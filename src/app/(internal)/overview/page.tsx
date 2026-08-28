import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal } from '@/server/auth/actor';
import { getOverviewMetrics } from '@/server/modules/dashboard/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { MarketingStatusBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Overview' };

/**
 * Counts here are RLS-filtered, so a recruiter sees their own book and a
 * manager sees the unit's — with no role branching in this file.
 */
export default async function OverviewPage() {
  const actor = await requireInternal();
  const metrics = await getOverviewMetrics(actor.userId);

  // Every figure is counted from records. Nothing here is a stored total, and
  // nobody types these numbers in.
  const tiles = [
    { label: 'Candidates', value: metrics.totalCandidates, hint: 'Visible to you, excluding archived' },
    { label: 'Applications', value: metrics.applications, hint: `${metrics.applicationsLast30Days} in the last 30 days` },
    { label: 'Open applications', value: metrics.openApplications, hint: 'Not rejected, withdrawn or closed' },
    { label: 'Interviews', value: metrics.interviews, hint: 'Recorded across your candidates' },
    { label: 'Live marketing periods', value: metrics.activePeriods, hint: 'Active or ready for marketing' },
    { label: 'Assigned to you', value: metrics.myActiveAssignments, hint: 'Current assignments' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Good to see you, ${actor.fullName.split(' ')[0]}`}
        description="A summary of the candidates and marketing activity you can access."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/candidates">View candidates</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardBody>
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                {tile.label}
              </p>
              <p className="tabular mt-1.5 text-[26px] font-semibold leading-none text-[var(--text-primary)]">
                {tile.value}
              </p>
              <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">{tile.hint}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidates by marketing status</CardTitle>
        </CardHeader>
        <CardBody>
          {metrics.byStatus.length === 0 ? (
            <EmptyState
              title="No candidates yet"
              body="Candidates you can access will be summarised here. A manager or administrator adds the first one."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {metrics.byStatus.map(({ status, count }) => (
                <li
                  key={status}
                  className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-2 last:border-b-0 last:pb-0"
                >
                  <MarketingStatusBadge status={status} />
                  <span className="tabular text-[14px] font-medium text-[var(--text-primary)]">
                    {count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
