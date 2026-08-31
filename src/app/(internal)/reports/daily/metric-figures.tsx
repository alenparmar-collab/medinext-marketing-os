import { DAILY_REPORT_METRICS } from '@/config/statuses';
import type { ReportMetrics } from '@/server/modules/reports/queries';

/**
 * The five figures, always in the same order and always labelled with where
 * they came from.
 *
 * "System-calculated" is not decoration. The whole point of this screen is
 * that a recruiter reading it can tell at a glance that nobody typed these in,
 * and that the only thing they are asked to supply is judgement.
 */
export function MetricFigures({
  metrics,
  compareWith,
}: {
  metrics: ReportMetrics;
  /** When given, differences from this set are called out. */
  compareWith?: ReportMetrics | null;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {DAILY_REPORT_METRICS.map(({ key, label }) => {
        const value = metrics[key];
        const other = compareWith?.[key];
        const differs = other !== undefined && other !== value;

        return (
          <div
            key={key}
            className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2.5"
          >
            <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {label}
            </dt>
            <dd className="tabular mt-1 text-[22px] font-semibold leading-none text-[var(--text-primary)]">
              {value}
            </dd>
            {differs ? (
              <p className="mt-1 text-[11.5px] text-[var(--color-critical)]">
                Records now say {other}
              </p>
            ) : null}
          </div>
        );
      })}
    </dl>
  );
}
