import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { getMyTimeline } from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/patterns/states';
import { Badge } from '@/components/ui/badge';
import { ACTIVITY_TYPE_META } from '@/config/statuses';
import { formatDateTime } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Activity' };

/**
 * The candidate's own chronological record.
 *
 * This page does not decide what to hide. The database already did: the RLS
 * policy admits only the candidate's own rows marked candidate_visible, and a
 * trigger forces every internal note to internal visibility regardless of what
 * created it. Duplicating that rule here would create a second place for it to
 * go wrong.
 */
export default async function PortalActivityPage() {
  const actor = await requireCandidate();
  const entries = await getMyTimeline(actor.candidateId);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Activity"
        description="What has happened with your job search, newest first."
      />

      {entries.length === 0 ? (
        <EmptyState
          title="Nothing to show yet"
          body="Applications, interviews and assessments will appear here as your recruiter records them."
        />
      ) : (
        <Card>
          <CardBody>
            <ol className="flex flex-col">
              {entries.map((entry) => {
                const meta = ACTIVITY_TYPE_META[entry.activityType];
                return (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-1 border-b border-[var(--border-subtle)] py-3 last:border-b-0 first:pt-0 sm:flex-row sm:gap-4"
                  >
                    <time
                      dateTime={entry.activityDate}
                      className="tabular w-40 shrink-0 text-[12.5px] text-[var(--text-muted)]"
                    >
                      {formatDateTime(entry.activityDate)}
                    </time>
                    <div className="min-w-0">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {entry.summary ? (
                        <p className="mt-1 text-[13.5px] text-[var(--text-primary)]">
                          {entry.summary}
                        </p>
                      ) : null}
                      {entry.companyName ? (
                        <p className="text-[12.5px] text-[var(--text-muted)]">
                          {entry.companyName}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
