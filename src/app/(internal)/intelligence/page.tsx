import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '@/server/auth/actor';
import { listIntelligenceRuns } from '@/server/modules/intelligence/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, NoResultsState } from '@/components/patterns/states';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import {
  INTELLIGENCE_EVENT_TYPES,
  INTELLIGENCE_EVENT_TYPE_META,
  INTELLIGENCE_STATUSES,
  INTELLIGENCE_STATUS_META,
} from '@/config/statuses';
import type { IntelligenceEventType, IntelligenceStatus } from '@/config/statuses';
import { CONFIDENCE_BAND_META, confidenceBand } from '@/config/intelligence';

export const metadata: Metadata = { title: 'Interpretation' };

/**
 * What the model made of the mailbox.
 *
 * Every row is a PROPOSAL. Nothing on this page has changed a candidate,
 * application, interview or assessment, and nothing on it can — acting on a
 * reading is a separate build with its own decision and review step. The
 * language is chosen to keep that obvious: "proposes", "reading",
 * "needs review", never "detected" or "created".
 */
export default async function IntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; event?: string; page?: string; all?: string }>;
}) {
  await requirePermission('intelligence.view');
  const filters = await searchParams;

  const status = (INTELLIGENCE_STATUSES as readonly string[]).includes(filters.status ?? '')
    ? (filters.status as IntelligenceStatus)
    : undefined;
  const eventType = (INTELLIGENCE_EVENT_TYPES as readonly string[]).includes(filters.event ?? '')
    ? (filters.event as IntelligenceEventType)
    : undefined;

  const page = Number(filters.page ?? '1');
  const result = await listIntelligenceRuns({
    status,
    eventType,
    latestOnly: filters.all !== '1',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 25,
  });

  const filtered = Boolean(status || eventType);
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Interpretation"
        description="What a model made of each email. Every reading is a proposal — nothing here has changed a candidate, application, interview or assessment."
      />

      <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2.5">
        <p className="text-[12.5px] text-[var(--text-secondary)]">
          Readings are produced by a language model and are not verified. A proposed candidate is
          resolved from identifiers found in the message, never chosen by the model, and a name on
          its own is never enough to propose anyone.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
          {filtered ? (
            <Link
              href="/intelligence"
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              Clear
            </Link>
          ) : null}
        </CardHeader>
        <CardBody>
          <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">Outcome</span>
              <select
                name="status"
                defaultValue={status ?? ''}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 pr-8 text-[14px] text-[var(--text-primary)]"
              >
                <option value="">Any outcome</option>
                {INTELLIGENCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {INTELLIGENCE_STATUS_META[s].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">
                Reads as
              </span>
              <select
                name="event"
                defaultValue={eventType ?? ''}
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 pr-8 text-[14px] text-[var(--text-primary)]"
              >
                <option value="">Anything</option>
                {INTELLIGENCE_EVENT_TYPES.map((e) => (
                  <option key={e} value={e}>
                    {INTELLIGENCE_EVENT_TYPE_META[e].label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 sm:col-span-1">
              <input
                type="checkbox"
                name="all"
                value="1"
                defaultChecked={filters.all === '1'}
                className="h-4 w-4"
              />
              <span className="text-[13px] text-[var(--text-secondary)]">
                Include earlier readings
              </span>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-3 text-[14px] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
              >
                Apply
              </button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Readings</CardTitle>
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            {result.total} {result.total === 1 ? 'reading' : 'readings'}
            {lastPage > 1 ? ` · page ${result.page} of ${lastPage}` : ''}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {result.items.length === 0 ? (
            <div className="p-5">
              {filtered ? (
                <NoResultsState
                  onClear={
                    <Link
                      href="/intelligence"
                      className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                    >
                      Clear the filters
                    </Link>
                  }
                />
              ) : (
                <EmptyState
                  title="Nothing interpreted yet"
                  body="Open an email and ask for a reading. Interpretation runs on demand — nothing is sent to a provider on its own."
                  action={
                    <Link
                      href="/emails"
                      className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                    >
                      Open the email explorer
                    </Link>
                  }
                />
              )}
            </div>
          ) : (
            <ul className="flex flex-col">
              {result.items.map((run) => {
                const band = confidenceBand(run.eventConfidence);
                return (
                  <li
                    key={run.id}
                    className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-3.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-[var(--text-primary)]">
                        <Link
                          href={`/intelligence/${run.id}`}
                          className="hover:text-[var(--color-accent-600)] hover:underline"
                        >
                          {run.emailSubject ?? '(no subject)'}
                        </Link>
                      </p>
                      <p className="text-[13px] text-[var(--text-secondary)]">{run.emailFrom}</p>
                      {run.summary ? (
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] text-[var(--text-muted)]">
                          {run.summary}
                        </p>
                      ) : null}
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
                        {run.proposedCandidateName ? (
                          <span>Proposes {run.proposedCandidateName}</span>
                        ) : (
                          <span>No candidate proposed</span>
                        )}
                        {run.runNumber > 1 ? <span>· reading {run.runNumber}</span> : null}
                        <span>· {run.model}</span>
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge tone={INTELLIGENCE_STATUS_META[run.status].tone}>
                        {INTELLIGENCE_STATUS_META[run.status].label}
                      </Badge>
                      {run.eventType ? (
                        <Badge tone={INTELLIGENCE_EVENT_TYPE_META[run.eventType].tone}>
                          {INTELLIGENCE_EVENT_TYPE_META[run.eventType].label}
                        </Badge>
                      ) : null}
                      {run.eventConfidence !== null ? (
                        <span className="tabular text-[12px] text-[var(--text-muted)]">
                          {CONFIDENCE_BAND_META[band].label} ·{' '}
                          {(run.eventConfidence * 100).toFixed(0)}%
                        </span>
                      ) : null}
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {formatRelative(run.createdAt)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {lastPage > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between">
          {result.page > 1 ? (
            <Link
              href={`/intelligence?page=${result.page - 1}`}
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="tabular text-[13px] text-[var(--text-muted)]">
            Page {result.page} of {lastPage}
          </span>
          {result.page < lastPage ? (
            <Link
              href={`/intelligence?page=${result.page + 1}`}
              className="text-[13px] text-[var(--color-accent-600)] hover:underline"
            >
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <p className="text-[12px] text-[var(--text-muted)]">
        Last interpreted {result.items[0] ? formatDateTime(result.items[0].createdAt) : 'never'}.
      </p>
    </div>
  );
}
