import type { Metadata } from 'next';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import { getOperationsSummary } from '@/server/modules/operations/queries';
import type { CountedBucket } from '@/server/modules/operations/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/patterns/states';
import { UnauthorizedState } from '@/components/patterns/states';
import { formatDate } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Operations day' };

/**
 * What actually happened today.
 *
 * Distinct from /reports/daily, which is Build 5's report a recruiter WRITES
 * and confirms. This one is derived and read-only: nobody types a figure, and
 * every figure is a count of rows that exist.
 *
 * The rule the page is built around: A NUMBER YOU CANNOT OPEN IS A NUMBER
 * NOBODY CAN DEFEND. So each count carries the records it counted, listed
 * underneath, and "Interviews: 2" is followed by the two interviews.
 */
export default async function OperationsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const actor = await requireInternal();

  // Reading the operational day means reading proposals; a recruiter without
  // that capability gets the same refusal the queue gives them.
  if (!can(actor, 'proposal.review')) {
    return (
      <UnauthorizedState body="Operational reporting covers the email intelligence queue, which needs permission to review proposals." />
    );
  }

  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? (params.date as string) : today;

  const summary = await getOperationsSummary(date);

  const shift = (days: number) => {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const crmTotal =
    summary.applications.count +
    summary.interviews.count +
    summary.assessments.count +
    summary.rejections.count;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Operations day"
        description="Counted from the records that exist. Nothing here is typed in, and a proposal still in review is not counted as anything."
      />

      <Card>
        <CardHeader>
          <CardTitle>{formatDate(date)}</CardTitle>
          <div className="flex items-center gap-3">
            <Link
              href={`/reports/operations?date=${shift(-1)}`}
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              ← Previous day
            </Link>
            {date < today ? (
              <Link
                href={`/reports/operations?date=${shift(1)}`}
                className="text-[13px] text-[var(--color-accent-600)] hover:underline"
              >
                Next day →
              </Link>
            ) : null}
          </div>
        </CardHeader>
        <CardBody>
          <form action="/reports/operations" method="get" className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="date" className="text-[12px] text-[var(--text-secondary)]">
                Show a different day
              </label>
              <input
                id="date"
                name="date"
                type="date"
                defaultValue={date}
                max={today}
                className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--surface-raised)] px-3 text-[13.5px] text-[var(--text-primary)]"
              />
            </div>
            <button
              type="submit"
              className="h-9 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
            >
              Show
            </button>
          </form>
        </CardBody>
      </Card>

      {crmTotal === 0 && summary.needsReview === 0 && summary.emailsReceived === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No activity recorded for this date"
              body="No records were created, no proposals were decided and no email arrived on this day."
            />
          </CardBody>
        </Card>
      ) : (
        <>
          {/* WHAT EXISTS. Records, not proposals. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Applications" value={summary.applications.count} />
            <Tile label="Interviews" value={summary.interviews.count} />
            <Tile label="Assessments" value={summary.assessments.count} />
            <Tile label="Rejections" value={summary.rejections.count} />
          </div>

          {/* WHAT THE QUEUE DID. Proposals, kept visibly apart from records. */}
          <Card>
            <CardHeader>
              <CardTitle>Decisions</CardTitle>
              <span className="text-[12.5px] text-[var(--text-muted)]">
                Proposals, not records — never added to the figures above
              </span>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Stat label="Needs review" value={summary.needsReview} />
                <Stat label="Written automatically" value={summary.autoApproved} />
                <Stat label="Approved by a person" value={summary.humanApproved} />
                <Stat label="Ignored" value={summary.ignored} />
                <Stat label="Rejected" value={summary.rejectedProposals} />
                <Stat label="Interpretation changes" value={summary.interpretationChanges} />
                <Stat label="Partial failures" value={summary.partialFailures} />
                <Stat label="High priority waiting" value={summary.highPriorityOpen} />
              </dl>
            </CardBody>
          </Card>

          {/* PIPELINE VOLUME. Deliberately last and deliberately labelled: an
              email is not an application, and a busy mailbox is not a busy day. */}
          <Card>
            <CardHeader>
              <CardTitle>Pipeline volume</CardTitle>
              <span className="text-[12.5px] text-[var(--text-muted)]">
                Not CRM activity
              </span>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                <Stat label="Emails received" value={summary.emailsReceived} />
                <Stat label="Interpretations" value={summary.interpretations} />
                <Stat label="Records from email" value={summary.fromEmail} />
                <Stat label="Records from a person" value={summary.fromPerson} />
              </dl>
            </CardBody>
          </Card>

          {/* THE RECORDS BEHIND THE NUMBERS. */}
          <Breakdown title="Applications" bucket={summary.applications} />
          <Breakdown title="Interviews" bucket={summary.interviews} />
          <Breakdown title="Assessments" bucket={summary.assessments} />
          <Breakdown title="Rejections" bucket={summary.rejections} />
        </>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
      <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="tabular mt-1 text-[26px] font-semibold leading-none text-[var(--text-primary)]">
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-[var(--text-muted)]">{label}</dt>
      <dd className="tabular text-[18px] font-semibold text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

/**
 * The records behind one figure.
 *
 * This is the part that makes the number defensible six months later: not "we
 * recorded two interviews" but "we recorded these two interviews, and here they
 * are".
 */
function Breakdown({ title, bucket }: { title: string; bucket: CountedBucket }) {
  if (bucket.count === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {bucket.count} {bucket.count === 1 ? title.replace(/s$/, '') : title}
        </CardTitle>
        <span className="text-[12.5px] text-[var(--text-muted)]">
          Every record counted above
        </span>
      </CardHeader>
      <CardBody className="p-0">
        <ul className="flex flex-col">
          {bucket.records.map((record) => (
            <li
              key={record.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-5 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <Link
                  href={record.href}
                  className="text-[13.5px] font-medium text-[var(--text-primary)] hover:text-[var(--color-accent-600)] hover:underline"
                >
                  {record.label}
                </Link>
                {record.candidateName ? (
                  <p className="text-[12.5px] text-[var(--text-secondary)]">
                    {record.candidateName}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge tone={record.source === 'email' ? 'info' : 'neutral'}>{record.source}</Badge>
                <Badge tone={record.verified ? 'positive' : 'muted'}>
                  {record.verified ? 'Verified' : 'Unverified'}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
