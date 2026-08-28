import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { getMyMarketingPeriods } from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { MarketingStatusBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { formatDate } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'My marketing' };

export default async function PortalMarketingPage() {
  const actor = await requireCandidate();
  const periods = await getMyMarketingPeriods(actor.candidateId);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="My marketing"
        description="The periods during which we have been actively marketing you."
      />

      {periods.length === 0 ? (
        <EmptyState
          title="No marketing periods yet"
          body="When your recruiter starts marketing you, the dates and status will appear here."
        />
      ) : (
        <Card>
          <CardBody>
            <ul className="flex flex-col">
              {periods.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-3 last:border-b-0"
                >
                  <span className="tabular text-[14px] text-[var(--text-primary)]">
                    {formatDate(p.startsOn)} — {p.endsOn ? formatDate(p.endsOn) : 'ongoing'}
                  </span>
                  <MarketingStatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
