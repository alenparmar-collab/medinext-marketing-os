import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission, can } from '@/server/auth/actor';
import { listReviewItems } from '@/server/modules/review';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/patterns/states';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import {
  REVIEW_ITEM_PRIORITY_META,
  REVIEW_ITEM_STATUSES,
  REVIEW_ITEM_STATUS_META,
  REVIEW_ITEM_TYPES,
  REVIEW_ITEM_TYPE_META,
} from '@/config/statuses';
import type { ReviewItemStatus, ReviewItemType } from '@/config/statuses';
import { RunChecksButton, CreateReviewItemForm } from './review-controls';

export const metadata: Metadata = { title: 'Review Queue' };

/**
 * The review queue.
 *
 * NEUTRAL LANGUAGE THROUGHOUT. Every item here says a person should look at
 * something. Nothing on this page asserts that anybody did anything wrong, and
 * the vocabulary is fixed in config/statuses.ts so no screen can invent an
 * accusatory label of its own.
 */
export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; itemType?: string }>;
}) {
  const actor = await requirePermission('review.view');
  const filters = await searchParams;

  const status = (REVIEW_ITEM_STATUSES as readonly string[]).includes(filters.status ?? '')
    ? (filters.status as ReviewItemStatus)
    : undefined;
  const itemType = (REVIEW_ITEM_TYPES as readonly string[]).includes(filters.itemType ?? '')
    ? (filters.itemType as ReviewItemType)
    : undefined;

  const items = await listReviewItems({
    ...(status ? { status } : {}),
    ...(itemType ? { itemType } : {}),
    limit: 100,
  });

  const canManage = can(actor, 'review.manage');
  const open = items.filter((i) => REVIEW_ITEM_STATUS_META[i.status].isOpen);
  const closed = items.filter((i) => !REVIEW_ITEM_STATUS_META[i.status].isOpen);

  const statusTabs: { label: string; href: string; active: boolean }[] = [
    { label: 'All', href: '/review', active: !status },
    ...REVIEW_ITEM_STATUSES.map((s) => ({
      label: REVIEW_ITEM_STATUS_META[s].label,
      href: `/review?status=${s}`,
      active: status === s,
    })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Review queue"
        description="Records that need a person to look at them. Nothing here says anyone did anything wrong."
        actions={canManage ? <RunChecksButton /> : null}
      />

      <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {statusTabs.map((tab) => (
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
          <CardTitle>Needs a look</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">{open.length} open</span>
        </CardHeader>
        <CardBody className="p-0">
          {open.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing waiting"
                body="The consistency checks found nothing that needs a decision. Items appear here when a record looks incomplete, duplicated or unclear."
              />
            </div>
          ) : (
            <ul className="flex flex-col">
              {open.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-[var(--text-primary)]">
                      <Link
                        href={`/review/${item.id}`}
                        className="hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {item.reason}
                      </Link>
                    </p>
                    <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                      {item.candidateName ? (
                        <>
                          <Link
                            href={`/candidates/${item.candidateId}`}
                            className="hover:text-[var(--color-accent-600)] hover:underline"
                          >
                            {item.candidateName}
                          </Link>
                          {' · '}
                        </>
                      ) : null}
                      {REVIEW_ITEM_TYPE_META[item.itemType].label}
                      {item.assignedToName ? ` · ${item.assignedToName}` : ' · Unassigned'}
                    </p>
                    <p className="tabular mt-0.5 text-[12px] text-[var(--text-muted)]">
                      Raised {formatRelative(item.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge tone={REVIEW_ITEM_STATUS_META[item.status].tone}>
                      {REVIEW_ITEM_STATUS_META[item.status].label}
                    </Badge>
                    <Badge tone={REVIEW_ITEM_PRIORITY_META[item.priority].tone}>
                      {REVIEW_ITEM_PRIORITY_META[item.priority].label}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Raise something yourself</CardTitle>
          </CardHeader>
          <CardBody>
            <CreateReviewItemForm />
          </CardBody>
        </Card>
      ) : null}

      {closed.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Closed</CardTitle>
            <span className="tabular text-[13px] text-[var(--text-muted)]">
              {closed.length} closed
            </span>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="flex flex-col">
              {closed.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-[var(--text-primary)]">
                      <Link
                        href={`/review/${item.id}`}
                        className="hover:text-[var(--color-accent-600)] hover:underline"
                      >
                        {item.reason}
                      </Link>
                    </p>
                    <p className="tabular mt-0.5 text-[12px] text-[var(--text-muted)]">
                      {item.resolvedAt ? formatDateTime(item.resolvedAt) : '—'}
                      {item.resolvedByName ? ` · ${item.resolvedByName}` : ''}
                    </p>
                  </div>
                  <Badge tone={REVIEW_ITEM_STATUS_META[item.status].tone}>
                    {REVIEW_ITEM_STATUS_META[item.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
