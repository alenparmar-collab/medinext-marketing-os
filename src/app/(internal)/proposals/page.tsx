import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/server/auth/actor';
import { listProposals } from '@/server/modules/decisions/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, NoResultsState } from '@/components/patterns/states';
import { formatRelative, formatDate } from '@/lib/utils/format';
import {
  INTELLIGENCE_EVENT_TYPE_META,
  REVIEW_ITEM_PRIORITY_META,
  INTELLIGENCE_EVENT_TYPES,
} from '@/config/statuses';
import type { IntelligenceEventType, ReviewItemPriority } from '@/config/statuses';
import {
  DECISION_REASON_META,
  PROPOSAL_REVIEW_STATUSES,
  PROPOSAL_REVIEW_STATUS_META,
} from '@/config/decisions';
import type { ProposalReviewStatus } from '@/config/decisions';

export const metadata: Metadata = { title: 'Proposals' };

/**
 * The proposal queue — the screen a marketing employee opens first.
 *
 * Separate from /review, which is Build 5's data-consistency queue: that one
 * asks "does this record look wrong", this one asks "may we create this
 * record". Same design language, different question, and merging them would
 * give one screen two jobs.
 *
 * Everything on a row answers one of the questions a reviewer actually has —
 * what is it, who is it about, why is it here, has it already produced
 * something, is somebody else on it. The list carries summaries only; evidence
 * loads when a proposal is opened.
 */
type Search = {
  status?: string;
  event?: string;
  priority?: string;
  changed?: string;
  failed?: string;
  q?: string;
  offset?: string;
};

const PAGE_SIZE = 25;

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requirePermission('proposal.review');
  const filters = await searchParams;

  const status = (PROPOSAL_REVIEW_STATUSES as readonly string[]).includes(filters.status ?? '')
    ? (filters.status as ProposalReviewStatus)
    : undefined;
  const eventType = (INTELLIGENCE_EVENT_TYPES as readonly string[]).includes(filters.event ?? '')
    ? (filters.event as IntelligenceEventType)
    : undefined;
  const priority = ['high', 'normal', 'low'].includes(filters.priority ?? '')
    ? (filters.priority as ReviewItemPriority)
    : undefined;
  const changedOnly = filters.changed === '1';
  const failedOnly = filters.failed === '1';
  const search = filters.q?.trim() || undefined;
  const offset = Number.parseInt(filters.offset ?? '0', 10) || 0;

  const anyFilter = Boolean(
    filters.status || eventType || priority || changedOnly || failedOnly || search,
  );

  const page = await listProposals({
    ...(status ? { status } : { openOnly: filters.status !== 'all' }),
    ...(eventType ? { eventType } : {}),
    ...(priority ? { priority } : {}),
    ...(changedOnly ? { changedOnly } : {}),
    ...(failedOnly ? { failedOnly } : {}),
    ...(search ? { search } : {}),
    limit: PAGE_SIZE,
    offset,
  });

  // Filters compose, so every link keeps the ones already on. A reviewer who
  // narrowed to high priority and then clicks Interview means both.
  const withParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams();
    const current: Record<string, string | undefined> = {
      status: filters.status,
      event: filters.event,
      priority: filters.priority,
      changed: filters.changed,
      failed: filters.failed,
      q: filters.q,
    };
    current[key] = value;
    for (const [k, v] of Object.entries(current)) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/proposals?${qs}` : '/proposals';
  };

  const statusTabs = [
    { label: 'Waiting', href: withParam('status', undefined), active: !filters.status },
    ...PROPOSAL_REVIEW_STATUSES.map((s) => ({
      label: PROPOSAL_REVIEW_STATUS_META[s].label,
      href: withParam('status', s),
      active: status === s,
    })),
    { label: 'Everything', href: withParam('status', 'all'), active: filters.status === 'all' },
  ];

  const eventTabs = [
    { label: 'Any type', href: withParam('event', undefined), active: !eventType },
    ...INTELLIGENCE_EVENT_TYPES.map((e) => ({
      label: INTELLIGENCE_EVENT_TYPE_META[e].label,
      href: withParam('event', e),
      active: eventType === e,
    })),
  ];

  const flagTabs = [
    {
      label: 'High priority',
      href: withParam('priority', priority === 'high' ? undefined : 'high'),
      active: priority === 'high',
    },
    {
      label: 'Interpretation changed',
      href: withParam('changed', changedOnly ? undefined : '1'),
      active: changedOnly,
    },
    {
      label: 'Partial failure',
      href: withParam('failed', failedOnly ? undefined : '1'),
      active: failedOnly,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Proposals"
        description="Events a model has proposed from email. Nothing here has been written unless it says approved."
      />

      <div className="flex flex-col gap-3">
        <FilterRow label="Filter by status" tabs={statusTabs} />
        <FilterRow label="Filter by event type" tabs={eventTabs} />
        <FilterRow label="Filter by flag" tabs={flagTabs} />

        {/* GET, so a filtered queue is a shareable URL and the back button works. */}
        <form action="/proposals" method="get" className="flex flex-wrap gap-2">
          {status ? <input type="hidden" name="status" value={filters.status} /> : null}
          {eventType ? <input type="hidden" name="event" value={eventType} /> : null}
          {priority ? <input type="hidden" name="priority" value={priority} /> : null}
          {changedOnly ? <input type="hidden" name="changed" value="1" /> : null}
          {failedOnly ? <input type="hidden" name="failed" value="1" /> : null}
          <label htmlFor="proposal-search" className="sr-only">
            Search proposals by candidate, company, subject, sender or role
          </label>
          <input
            id="proposal-search"
            name="q"
            type="search"
            defaultValue={filters.q ?? ''}
            placeholder="Candidate, company, subject, sender or role"
            className="h-9 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 text-[13.5px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-200)]"
          />
          <button
            type="submit"
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
          >
            Search
          </button>
          {search ? (
            <Link
              href={withParam('q', undefined)}
              className="flex h-9 items-center px-2 text-[13px] text-[var(--text-secondary)] hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            {page.items.length === 0
              ? 'Nothing to show'
              : `${offset + 1}–${offset + page.items.length}${page.hasMore ? '' : ' of ' + (offset + page.items.length)}`}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {page.items.length === 0 ? (
            <div className="p-5">
              {anyFilter ? (
                <NoResultsState
                  onClear={
                    <Link
                      href="/proposals"
                      className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                    >
                      Clear filters
                    </Link>
                  }
                />
              ) : (
                <EmptyState
                  title="You're all caught up"
                  body="Nothing is waiting for a decision. Proposals appear here when a reading of an email suggests a record but cannot be written without a person; complete, unambiguous ones are written automatically and appear under Approved."
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
              {page.items.map((item) => {
                const priorityMeta = REVIEW_ITEM_PRIORITY_META[item.priority];
                const partial = item.failureCode === 'partial_failure';
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
                          {item.company ? ` · ${item.company}` : ''}
                        </Link>
                      </p>
                      <p className="text-[13px] text-[var(--text-secondary)]">
                        {item.emailSubject ?? '(no subject)'} · {item.emailFrom}
                      </p>

                      {/* Why am I seeing this — answered in the list, not just on the detail. */}
                      {item.reasonCodes.length > 0 ? (
                        <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                          {DECISION_REASON_META[
                            item.reasonCodes[0] as keyof typeof DECISION_REASON_META
                          ]?.label ?? 'Held for review.'}
                          {item.reasonCodes.length > 1
                            ? ` (+${item.reasonCodes.length - 1} more)`
                            : ''}
                        </p>
                      ) : null}

                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-muted)]">
                        {item.emailReceivedAt ? (
                          <span>Email {formatDate(item.emailReceivedAt)}</span>
                        ) : null}
                        {item.createdRecordId ? (
                          <span className="text-[var(--text-secondary)]">
                            Created {item.createdRecordKind}
                          </span>
                        ) : null}
                        {item.claimedByName && item.status === 'in_review' ? (
                          <span>Claimed by {item.claimedByName}</span>
                        ) : null}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {partial ? (
                        <Badge tone="caution">Partial failure</Badge>
                      ) : (
                        <Badge tone={PROPOSAL_REVIEW_STATUS_META[item.status].tone}>
                          {PROPOSAL_REVIEW_STATUS_META[item.status].label}
                        </Badge>
                      )}
                      <Badge tone={priorityMeta.tone}>{priorityMeta.label} priority</Badge>
                      {item.interpretationChanged ? (
                        <Badge tone="caution">Interpretation changed</Badge>
                      ) : null}
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

      {(offset > 0 || page.hasMore) && page.items.length > 0 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          {offset > 0 ? (
            <Link
              href={`${withParam('offset', undefined)}${withParam('offset', undefined).includes('?') ? '&' : '?'}offset=${Math.max(offset - PAGE_SIZE, 0)}`}
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {page.hasMore ? (
            <Link
              href={`${withParam('offset', undefined)}${withParam('offset', undefined).includes('?') ? '&' : '?'}offset=${offset + PAGE_SIZE}`}
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

function FilterRow({
  label,
  tabs,
}: {
  label: string;
  tabs: { label: string; href: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {tabs.map((tab) => (
        <Link
          key={`${label}-${tab.label}`}
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
  );
}
