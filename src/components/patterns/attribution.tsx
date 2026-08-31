import { SOURCE_KIND_META } from '@/config/statuses';
import type { SourceKind } from '@/config/statuses';

/**
 * Three facts about a record that are routinely confused, shown side by side so
 * they cannot be.
 *
 *   RESPONSIBLE RECRUITER — who was accountable for this candidate's marketing
 *                           when the event happened. This is what the daily
 *                           report counts.
 *   CREATED BY            — who or what produced the row. A manager entering it
 *                           on somebody's behalf, or nothing human at all.
 *   SOURCE                — how it arrived: typed in, imported, from an email.
 *
 * A single "owner" field would collapse all three, and then a record created by
 * an automated pipeline would either belong to nobody or belong to the machine.
 */
export function Attribution({
  responsibleRecruiterName,
  createdByName,
  source,
  sourceReference,
  className,
}: {
  responsibleRecruiterName: string | null;
  createdByName: string | null;
  source: SourceKind;
  sourceReference?: string | null;
  className?: string;
}) {
  const meta = SOURCE_KIND_META[source];

  return (
    <dl className={className}>
      <div className="flex flex-col gap-0.5">
        <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Responsible recruiter
        </dt>
        <dd className="text-[14px] text-[var(--text-primary)]">
          {responsibleRecruiterName ?? (
            <span className="text-[var(--text-muted)]">
              Not attributed — nobody was assigned at the time
            </span>
          )}
        </dd>
      </div>

      <div className="flex flex-col gap-0.5">
        <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Created by
        </dt>
        <dd className="text-[14px] text-[var(--text-primary)]">
          {/* No human actor is System, not "unknown": the distinction is real. */}
          {createdByName ?? <span className="text-[var(--text-secondary)]">System</span>}
        </dd>
      </div>

      <div className="flex flex-col gap-0.5">
        <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
          Source
        </dt>
        <dd className="text-[14px] text-[var(--text-primary)]">
          {meta.label}
          {sourceReference ? (
            <span className="ml-1.5 break-all text-[12px] text-[var(--text-muted)]">
              {sourceReference}
            </span>
          ) : null}
        </dd>
      </div>
    </dl>
  );
}
