import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireInternal } from '@/server/auth/actor';
import { getCandidate } from '@/server/modules/candidates/queries';
import { AppError } from '@/server/auth/errors';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { MarketingStatusBadge } from '@/components/patterns/status-badge';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/patterns/states';
import { ASSIGNMENT_TYPE_LABELS } from '@/config/statuses';
import { formatDate, formatExperience, formatFileSize } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Candidate' };

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-48 shrink-0 text-[13px] text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-[14px] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function TagList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) {
    return <span className="text-[var(--text-muted)]">{empty}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <Badge key={v} tone="neutral">
          {v}
        </Badge>
      ))}
    </div>
  );
}

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  await requireInternal();
  const { candidateId } = await params;

  let candidate;
  try {
    candidate = await getCandidate(candidateId);
  } catch (error) {
    // RLS filtered it out or it does not exist — the two are deliberately
    // indistinguishable, since a 403 would confirm the record exists.
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const activeAssignments = candidate.assignments.filter((a) => a.isActive);
  const pastAssignments = candidate.assignments.filter((a) => !a.isActive);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={candidate.reference}
        title={candidate.fullName}
        description={candidate.email}
        actions={<MarketingStatusBadge status={candidate.marketingStatus} />}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="flex flex-col">
              <DetailRow label="Primary skill" value={candidate.primarySkill ?? '—'} />
              <DetailRow
                label="Skills"
                value={<TagList values={candidate.skills} empty="None recorded" />}
              />
              <DetailRow
                label="Experience"
                value={formatExperience(candidate.experienceMonths)}
              />
              <DetailRow label="Current location" value={candidate.currentLocation ?? '—'} />
              {/*
                Preferred locations are OPTIONAL. An empty value is a complete
                record, not a gap to chase — so the copy says so plainly and
                nothing compares this against current location.
              */}
              <DetailRow
                label="Preferred locations"
                value={
                  <TagList
                    values={candidate.preferredLocations}
                    empty="Not specified (optional)"
                  />
                }
              />
              <DetailRow label="Visa status" value={candidate.visaStatus ?? '—'} />
              <DetailRow label="Education" value={candidate.education ?? '—'} />
              <DetailRow
                label="Certifications"
                value={<TagList values={candidate.certifications} empty="None recorded" />}
              />
              <DetailRow label="Phone" value={candidate.phone ?? '—'} />
              <DetailRow
                label="Portal access"
                value={
                  candidate.hasPortalAccess ? (
                    <Badge tone="positive">Invited</Badge>
                  ) : (
                    <Badge tone="muted">Not invited</Badge>
                  )
                }
              />
              <DetailRow label="Added" value={formatDate(candidate.createdAt)} />
            </dl>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Assignments</CardTitle>
            </CardHeader>
            <CardBody>
              {activeAssignments.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)]">
                  Nobody is currently assigned to this candidate.
                </p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {activeAssignments.map((a) => (
                    <li key={a.id} className="flex flex-col gap-0.5">
                      <span className="text-[14px] font-medium text-[var(--text-primary)]">
                        {a.userName}
                      </span>
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {ASSIGNMENT_TYPE_LABELS[a.assignmentType]} · since {formatDate(a.startsOn)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {pastAssignments.length > 0 ? (
                <details className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                  <summary className="cursor-pointer text-[13px] text-[var(--text-secondary)]">
                    {pastAssignments.length} past assignment
                    {pastAssignments.length === 1 ? '' : 's'}
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {pastAssignments.map((a) => (
                      <li key={a.id} className="text-[12px] text-[var(--text-muted)]">
                        {a.userName} · {ASSIGNMENT_TYPE_LABELS[a.assignmentType]} ·{' '}
                        {formatDate(a.startsOn)} to {formatDate(a.endsOn)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardBody>
              {candidate.documents.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)]">No documents uploaded.</p>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {candidate.documents.map((d) => (
                    <li key={d.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] text-[var(--text-primary)]">
                          {d.fileName}
                        </p>
                        <p className="text-[12px] text-[var(--text-muted)]">
                          {d.documentType} · {formatFileSize(d.sizeBytes)} · v{d.version}
                        </p>
                      </div>
                      {d.visibility === 'candidate_visible' ? (
                        <Badge tone="positive">Shared</Badge>
                      ) : (
                        <Badge tone="muted">Internal</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Marketing periods</CardTitle>
        </CardHeader>
        <CardBody>
          {candidate.marketingPeriods.length === 0 ? (
            <EmptyState
              title="No marketing periods"
              body="A marketing period records the window during which this candidate is actively marketed. Open one from the Marketing area."
            />
          ) : (
            <ul className="flex flex-col">
              {candidate.marketingPeriods.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-3 last:border-b-0"
                >
                  <div>
                    <p className="tabular text-[14px] text-[var(--text-primary)]">
                      {formatDate(p.startsOn)} — {p.endsOn ? formatDate(p.endsOn) : 'ongoing'}
                    </p>
                    {p.objective ? (
                      <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
                        {p.objective}
                      </p>
                    ) : null}
                  </div>
                  <MarketingStatusBadge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
