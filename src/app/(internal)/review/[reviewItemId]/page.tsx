import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/server/auth/actor';
import { AppError } from '@/server/auth/errors';
import { getReviewItem } from '@/server/modules/review';
import { listAssignableUsers } from '@/server/modules/admin/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SourceBadge } from '@/components/patterns/status-badge';
import { formatDateTime } from '@/lib/utils/format';
import {
  REVIEW_ITEM_PRIORITY_META,
  REVIEW_ITEM_STATUS_META,
  REVIEW_ITEM_TYPE_META,
  REVIEW_RESOLUTION_META,
} from '@/config/statuses';
import { AssignControl, ResolveControl, ReviewStatusControl } from '../review-controls';

export const metadata: Metadata = { title: 'Review item' };

export default async function ReviewItemPage({
  params,
}: {
  params: Promise<{ reviewItemId: string }>;
}) {
  const actor = await requirePermission('review.view');
  const { reviewItemId } = await params;

  let item;
  try {
    item = await getReviewItem(reviewItemId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const canManage = can(actor, 'review.manage');
  const assignees = canManage ? await listAssignableUsers() : [];
  const isOpen = REVIEW_ITEM_STATUS_META[item.status].isOpen;

  // Where the record actually is. Built from whichever reference the item
  // carries, so a reviewer never has to search for the thing being questioned.
  const links: { label: string; href: string }[] = [];
  if (item.candidateId) {
    links.push({ label: item.candidateName ?? 'Candidate', href: `/candidates/${item.candidateId}` });
  }
  if (item.applicationId) {
    links.push({ label: 'Application', href: `/applications/${item.applicationId}` });
  }
  if (item.interviewId) links.push({ label: 'Interview', href: `/interviews/${item.interviewId}` });
  if (item.assessmentId) {
    links.push({ label: 'Assessment', href: `/assessments/${item.assessmentId}` });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title={item.reason}
        description={REVIEW_ITEM_TYPE_META[item.itemType].label}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/review">Back to queue</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>What was noticed</CardTitle>
              <span className="flex items-center gap-1.5">
                <Badge tone={REVIEW_ITEM_STATUS_META[item.status].tone}>
                  {REVIEW_ITEM_STATUS_META[item.status].label}
                </Badge>
                <Badge tone={REVIEW_ITEM_PRIORITY_META[item.priority].tone}>
                  {REVIEW_ITEM_PRIORITY_META[item.priority].label}
                </Badge>
                <SourceBadge source={item.sourceType} isVerified={false} />
              </span>
            </CardHeader>
            <CardBody>
              <p className="text-[14px] text-[var(--text-primary)]">{item.reason}</p>
              {item.detail ? (
                <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-[var(--text-secondary)]">
                  {item.detail}
                </p>
              ) : null}

              <p className="tabular mt-3 text-[12px] text-[var(--text-muted)]">
                Raised {formatDateTime(item.createdAt)}
              </p>

              {links.length > 0 ? (
                <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    The records involved
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-3">
                    {links.map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          className="text-[13.5px] text-[var(--color-accent-600)] hover:underline"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {!isOpen ? (
            <Card>
              <CardHeader>
                <CardTitle>How it was closed</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="flex flex-col gap-3">
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      Outcome
                    </dt>
                    <dd className="text-[14px] text-[var(--text-primary)]">
                      {item.resolution ? REVIEW_RESOLUTION_META[item.resolution].label : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      What was decided
                    </dt>
                    <dd className="whitespace-pre-wrap text-[14px] text-[var(--text-primary)]">
                      {item.resolutionNotes ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                      Closed
                    </dt>
                    <dd className="tabular text-[14px] text-[var(--text-primary)]">
                      {item.resolvedAt ? formatDateTime(item.resolvedAt) : '—'}
                      {item.resolvedByName ? ` · ${item.resolvedByName}` : ''}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <CardTitle>Ownership</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-4">
                <AssignControl
                  reviewItemId={item.id}
                  currentAssignee={item.assignedTo}
                  options={assignees.map((a) => ({ id: a.id, fullName: a.fullName }))}
                />
                <ReviewStatusControl reviewItemId={item.id} currentStatus={item.status} />
              </CardBody>
            </Card>

            {isOpen ? (
              <Card>
                <CardHeader>
                  <CardTitle>Close this item</CardTitle>
                </CardHeader>
                <CardBody>
                  <ResolveControl reviewItemId={item.id} />
                </CardBody>
              </Card>
            ) : null}
          </div>
        ) : (
          <Card>
            <CardBody>
              <p className="text-[13px] text-[var(--text-secondary)]">
                You can see this item but not act on it. Resolving review items is a manager or
                administrator decision.
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
