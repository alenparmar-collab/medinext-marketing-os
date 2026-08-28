import type { Metadata } from 'next';
import Link from 'next/link';
import { requireCandidate } from '@/server/auth/actor';
import {
  getMyProfile,
  getMyMarketingPeriods,
  getMyDocuments,
  getMyCounts,
} from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { MarketingStatusBadge } from '@/components/patterns/status-badge';
import { EmptyState } from '@/components/patterns/states';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Home' };

export default async function PortalHomePage() {
  const actor = await requireCandidate();

  const [profile, periods, documents, counts] = await Promise.all([
    getMyProfile(actor.candidateId),
    getMyMarketingPeriods(actor.candidateId),
    getMyDocuments(actor.candidateId),
    getMyCounts(actor.candidateId),
  ]);

  const current = periods.find((p) => p.endsOn === null) ?? periods[0];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        eyebrow={profile.reference}
        title={`Hello, ${profile.fullName.split(' ')[0]}`}
        description="Where your job search stands right now."
        actions={<MarketingStatusBadge status={profile.marketingStatus} />}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your marketing</CardTitle>
          </CardHeader>
          <CardBody>
            {current ? (
              <>
                <p className="tabular text-[14px] text-[var(--text-primary)]">
                  Started {formatDate(current.startsOn)}
                  {current.endsOn ? ` · ended ${formatDate(current.endsOn)}` : ''}
                </p>
                <div className="mt-2">
                  <MarketingStatusBadge status={current.status} />
                </div>
              </>
            ) : (
              <p className="text-[13px] text-[var(--text-secondary)]">
                Your marketing has not started yet. Your recruiter will update this once it does.
              </p>
            )}
            <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2">
              <Link href="/portal/marketing">View details</Link>
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your documents</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="tabular text-[26px] font-semibold leading-none text-[var(--text-primary)]">
              {documents.length}
            </p>
            <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
              {documents.length === 0
                ? 'Nothing has been shared with you yet.'
                : 'Shared with you by your recruiter.'}
            </p>
            <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2">
              <Link href="/portal/documents">Open documents</Link>
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your progress</CardTitle>
        </CardHeader>
        <CardBody>
          {counts.applications === 0 ? (
            /*
              An empty portal reads as "nobody is working on me" unless it says
              otherwise. This is a UX requirement, not decoration — it directly
              reduces inbound "is anything happening?" contact.
            */
            <EmptyState
              title="Applications and interviews arrive here"
              body="Once your recruiter starts submitting you for roles, your applications, interviews and assessments will appear in this portal. There is nothing for you to do in the meantime."
            />
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-4">
                {[
                  { label: 'Applications', value: counts.applications },
                  { label: 'Interviews', value: counts.interviews },
                  { label: 'Assessments', value: counts.assessments },
                  { label: 'Offers', value: counts.offers },
                ].map((m) => (
                  <div key={m.label} className="bg-[var(--surface-raised)] px-4 py-3">
                    <dt className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                      {m.label}
                    </dt>
                    <dd className="tabular mt-1 text-[20px] font-semibold leading-none text-[var(--text-primary)]">
                      {m.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="secondary" size="sm">
                  <Link href="/portal/applications">View applications</Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/portal/activity">Recent activity</Link>
                </Button>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
