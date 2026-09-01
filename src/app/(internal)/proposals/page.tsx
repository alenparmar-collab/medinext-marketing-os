import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/server/auth/actor';
import { listProposals } from '@/server/modules/decisions/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, NoResultsState } from '@/components/patterns/states';
import { formatRelative } from '@/lib/utils/format';
import { INTELLIGENCE_EVENT_TYPE_META, REVIEW_ITEM_PRIORITY_META } from '@/config/statuses';
import type { IntelligenceEventType } from '@/config/statuses';
import {
  DECISION_REASON_META,
  PROPOSAL_REVIEW_STATUSES,
  PROPOSAL_REVIEW_STATUS_META,
} from '@/config/decisions';
import type { ProposalReviewStatus } from '@/config/decisions';

export const metadata: Metadata = { title: 'Proposals' };

/**
 * The proposal queue.
 *
 * Separate from /review, which is Build 5's data-consistency queue: that one
 * asks "does this record look wrong", this one asks "may we create this
 * record". Same design language, different question, and merging them would
 * give one screen two jobs.
 *
 * The list carries summaries only. Evidence loads when a proposal is opened.
 */
export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; event?: string }>;
}) {
  await requirePermission('proposal.review');
  const filters = await searchParams;

  const status = (PROPOSAL_REVIEW_STATUSES as readonly string[]).includes(filters.status ?? '')
    ? (filters.status as ProposalReviewStatus)
    : undefined;

  const items = await listProposals({
    ...(status ? { status } : { openOnly: filters.status !== 'all' }),
    ...(filters.event ? { eventType: filters.event as IntelligenceEventType } : {}),
    limit: 100,
  });

  const tabs = [
    { label: 'Waiting', href: '/proposals', active: !filters.status },
    ...PROPOSAL_REVIEW_STATUSES.map((s) => ({
      label: PROPOSAL_REVIEW_STATUS_META[s].label,
      href: `/proposals?status=${s}`,
      active: status === s,
    })),
    { label: 'Everything', href: '/proposals?status=all', active: filters.status === 'all' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Proposals"
        description="Events a model has proposed from email. Nothing here has been written unless it says approved."
      />

      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.active ? 'page' : undefined}
            className={
              tab.active
                ? 'rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-2.5 py-1 text-[13px] font-medium text-[var(--text-primary)]'
                : 'rounded-[var(--radius-sm)] px-2.5 py-1 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]'
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            {items.length} {items.length === 1 ? 'proposal' : 'proposals'}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {items.length === 0 ? (
            <div className="p-5">
              {filters.status ? (
                <NoResultsState
                  onClear={
                    <Link
                      href="/proposals"
                      className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                    >
                      Back to waiting
                    </Link>
                  }
                />
              ) : (
                <EmptyState
                  title="Nothing waiting"
                  body="Proposals appear here when a reading of an email suggests a record but cannot be written without a person. Complete, unambiguous ones are written automatically and appear under Approved."
                  action={
                    <Link
                      href="/intelligence"
                      className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                    >
                      See what has been interpreted
                    </Link>
                  }
                />
              )}
            </div>
          ) : (
            <ul className="flex flex-col">
              {items.map((item) => {
                const priority = REVIEW_ITEM_PRIORITY_META[item.priority];
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-[var(--text-primary)]">
                        <Link
                          href={`/proposals/${item.id}`}
                          className="hover:text-[var(--color-accent-600)] hover:underline"
                        >
                          {INTELLIGENCE_EVENT_TYPE_META[item.eventType].label}
                          {item.candidateName ? ` — ${item.candidateName}` : ''}
                        </Link>
                      </p>
                      <p className="text-[13px] text-[var(--text-secondary)]">
                        {item.emailSubject ?? '(no subject)'} · {item.emailFrom}
                      </p>
                      {/* Why am I seeing this — answered in the list, not just on the detail. */}
                      {item.reasonCodes.length > 0 ? (
                        <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                          {DECISION_REASON_META[item.reasonCodes[0] as keyof typeof DECISION_REASON_META]
                            ?.label ?? 'Held for review.'}
                          {item.reasonCodes.length > 1
                            ? ` (+${item.reasonCodes.length - 1} more)`
                            : ''}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge tone={PROPOSAL_REVIEW_STATUS_META[item.status].tone}>
                        {PROPOSAL_REVIEW_STATUS_META[item.status].label}
                      </Badge>
                      <Badge tone={priority.tone}>{priority.label} priority</Badge>
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {formatRelative(item.createdAt)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
