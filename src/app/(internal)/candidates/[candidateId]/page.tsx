import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireInternal, can } from '@/server/auth/actor';
import { getCandidate } from '@/server/modules/candidates/queries';
import { listInternalNotes } from '@/server/modules/notes';
import { AppError } from '@/server/auth/errors';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ASSIGNMENT_TYPE_LABELS } from '@/config/statuses';
import { formatDate, formatDateTime, formatExperience } from '@/lib/utils/format';
import { NotesPanel } from './notes-panel';

export const metadata: Metadata = { title: 'Candidate overview' };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-[13px] text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 text-[14px] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function Tags({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <span className="text-[var(--text-muted)]">{empty}</span>;
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

export default async function CandidateOverviewPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const actor = await requireInternal();
  const { candidateId } = await params;

  let candidate;
  try {
    candidate = await getCandidate(candidateId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const notes = await listInternalNotes(candidateId, actor.userId);
  const activeAssignments = candidate.assignments.filter((a) => a.isActive);
  const pastAssignments = candidate.assignments.filter((a) => !a.isActive);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="flex flex-col">
            <Row label="Email" value={candidate.email} />
            <Row label="Phone" value={candidate.phone ?? '—'} />
            <Row label="Primary skill" value={candidate.primarySkill ?? '—'} />
            <Row label="Skills" value={<Tags values={candidate.skills} empty="None recorded" />} />
            <Row label="Experience" value={formatExperience(candidate.experienceMonths)} />
            <Row label="Current location" value={candidate.currentLocation ?? '—'} />
            {/*
              Preferred locations are OPTIONAL. An empty value is a complete
              record, not a gap to chase, and nothing compares it against the
              current location or against a job location.
            */}
            <Row
              label="Preferred locations"
              value={<Tags values={candidate.preferredLocations} empty="Not specified (optional)" />}
            />
            <Row label="Visa status" value={candidate.visaStatus ?? '—'} />
            <Row label="Education" value={candidate.education ?? '—'} />
            <Row
              label="Certifications"
              value={<Tags values={candidate.certifications} empty="None recorded" />}
            />
            <Row
              label="Portal access"
              value={
                candidate.hasPortalAccess ? (
                  <Badge tone="positive">Invited</Badge>
                ) : (
                  <Badge tone="muted">Not invited</Badge>
                )
              }
            />
            <Row label="Added" value={formatDateTime(candidate.createdAt)} />
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

        {/*
          Internal notes. A candidate can never read these: the table has no
          candidate-facing RLS policy at all, so a portal user querying it
          receives zero rows.
        */}
        <NotesPanel
          candidateId={candidate.id}
          notes={notes}
          canWrite={can(actor, 'note.write')}
        />
      </div>
    </div>
  );
}
