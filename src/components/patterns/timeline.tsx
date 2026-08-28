import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ACTIVITY_TYPE_META, SOURCE_KIND_META, type ActivityType } from '@/config/statuses';
import { formatDateTime } from '@/lib/utils/format';
import type { TimelineEntry } from '@/server/modules/timeline/queries';

/**
 * The chronological candidate record.
 *
 * The same component serves both audiences. It never decides what to hide —
 * the database already did that, and duplicating the rule here would create a
 * second place for it to be wrong.
 *
 * Each entry shows date/time, event, company where applicable, actor or source,
 * and status where applicable.
 */
function entryLabel(kind: string): { label: string; tone: 'neutral' | 'info' | 'positive' | 'caution' | 'muted' } {
  if (kind === 'marketing_started') return { label: 'Marketing started', tone: 'info' };
  if (kind === 'marketing_ended') return { label: 'Marketing ended', tone: 'muted' };
  const meta = ACTIVITY_TYPE_META[kind as ActivityType];
  return meta ? { label: meta.label, tone: meta.tone } : { label: kind, tone: 'neutral' };
}

export function Timeline({
  entries,
  linkApplications = false,
}: {
  entries: TimelineEntry[];
  linkApplications?: boolean;
}) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry) => {
        const { label, tone } = entryLabel(entry.entryKind);
        const source = SOURCE_KIND_META[entry.sourceType];

        return (
          <li
            key={`${entry.entryKind}-${entry.entryId}-${entry.occurredAt}`}
            className="relative flex gap-3 border-b border-[var(--border-subtle)] py-3 last:border-b-0 first:pt-0"
          >
            <div className="flex w-32 shrink-0 flex-col">
              <time
                dateTime={entry.occurredAt}
                className="tabular text-[12.5px] text-[var(--text-muted)]"
              >
                {formatDateTime(entry.occurredAt)}
              </time>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone}>{label}</Badge>
                {entry.status ? (
                  <span className="text-[12px] text-[var(--text-muted)]">{entry.status}</span>
                ) : null}
                {/* Provenance is shown only when it is not ordinary manual entry. */}
                {entry.sourceType !== 'manual' && entry.sourceType !== 'seed' ? (
                  <Badge tone={entry.isVerified ? source.tone : 'caution'}>
                    {entry.isVerified ? source.label : `${source.label} · unverified`}
                  </Badge>
                ) : null}
              </div>

              {entry.title ? (
                <p className="mt-1 text-[13.5px] text-[var(--text-primary)]">{entry.title}</p>
              ) : null}

              {entry.detail ? (
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]">
                  {entry.detail}
                </p>
              ) : null}

              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-[var(--text-muted)]">
                {entry.companyName ? (
                  <>
                    {linkApplications && entry.applicationId ? (
                      <Link
                        href={`/applications/${entry.applicationId}`}
                        className="text-[var(--color-accent-600)] hover:underline"
                      >
                        {entry.companyName}
                      </Link>
                    ) : (
                      <span>{entry.companyName}</span>
                    )}
                  </>
                ) : null}
                {entry.companyName && entry.actorName ? <span aria-hidden="true">·</span> : null}
                {entry.actorName ? <span>{entry.actorName}</span> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
