import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireInternal } from '@/server/auth/actor';
import { getCandidate } from '@/server/modules/candidates/queries';
import { AppError } from '@/server/auth/errors';
import { MarketingStatusBadge } from '@/components/patterns/status-badge';
import { CandidateTabs } from './candidate-tabs';

/**
 * The candidate workspace shell.
 *
 * Identity, status and the summary metrics load ONCE here rather than in each
 * tab, so switching tabs never re-fetches the header. Every figure is derived
 * from records — there is no stored total anywhere in this product.
 */
export default async function CandidateLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ candidateId: string }>;
}) {
  await requireInternal();
  const { candidateId } = await params;

  let candidate;
  try {
    candidate = await getCandidate(candidateId);
  } catch (error) {
    // RLS filtered it out, or it does not exist. Deliberately indistinguishable:
    // a 403 would confirm the record exists.
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const primaryRecruiter =
    candidate.assignments.find((a) => a.isActive && a.assignmentType === 'primary_recruiter') ??
    candidate.assignments.find((a) => a.isActive);

  const metrics = [
    { label: 'Applications', value: candidate.counts.applications },
    { label: 'Responses', value: candidate.counts.recruiterResponses },
    { label: 'Interviews', value: candidate.counts.interviews },
    { label: 'Assessments', value: candidate.counts.assessments },
    { label: 'Rejections', value: candidate.counts.rejections },
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {candidate.reference}
            </p>
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-[var(--text-primary)]">
              {candidate.fullName}
              {candidate.isArchived ? (
                <span className="ml-2 align-middle text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                  Archived
                </span>
              ) : null}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-[var(--text-secondary)]">
              <span>{candidate.primarySkill ?? 'No primary skill recorded'}</span>
              <span aria-hidden="true" className="text-[var(--border-strong)]">
                ·
              </span>
              <span>
                {primaryRecruiter ? (
                  primaryRecruiter.userName
                ) : (
                  <span className="text-[var(--text-muted)]">Unassigned</span>
                )}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <MarketingStatusBadge status={candidate.marketingStatus} />
            <Link
              href={`/applications/new?candidate=${candidate.id}`}
              className="inline-flex h-8 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-600)] px-2.5 text-[13px] font-medium text-white transition-colors duration-100 hover:bg-[var(--color-accent-700)]"
            >
              Add application
            </Link>
          </div>
        </div>

        {/* Summary metrics, all derived from actual records. */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--border-subtle)] sm:grid-cols-5">
          {metrics.map((m) => (
            <div key={m.label} className="bg-[var(--surface-raised)] px-4 py-3">
              <dt className="text-[11px] font-medium uppercase tracking-[0.07em] text-[var(--text-muted)]">
                {m.label}
              </dt>
              <dd className="tabular mt-1 text-[20px] font-semibold leading-none text-[var(--text-primary)]">
                {m.value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <CandidateTabs candidateId={candidate.id} />

      {children}
    </div>
  );
}
