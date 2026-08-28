import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireInternal, can } from '@/server/auth/actor';
import { getApplication } from '@/server/modules/applications/queries';
import { listApplicationActivities } from '@/server/modules/activities/queries';
import { AppError } from '@/server/auth/errors';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ApplicationStatusBadge,
  ActivityTypeBadge,
  SourceBadge,
} from '@/components/patterns/status-badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime } from '@/lib/utils/format';
import { StatusChanger } from './status-changer';

export const metadata: Metadata = { title: 'Application' };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-[13px] text-[var(--text-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[14px] text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const actor = await requireInternal();
  const { applicationId } = await params;

  let application;
  try {
    application = await getApplication(applicationId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const activities = await listApplicationActivities(applicationId);
  const canEdit = can(actor, 'application.update');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`${application.candidateName} · ${application.candidateReference}`}
        title={application.companyName}
        description={application.positionTitle}
        actions={
          <div className="flex items-center gap-2">
            <ApplicationStatusBadge status={application.status} />
            <SourceBadge source={application.sourceType} isVerified={application.isVerified} />
            {canEdit ? (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/applications/${application.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="flex flex-col">
              <Row
                label="Candidate"
                value={
                  <Link
                    href={`/candidates/${application.candidateId}`}
                    className="text-[var(--color-accent-600)] hover:underline"
                  >
                    {application.candidateName}
                  </Link>
                }
              />
              <Row label="Company" value={application.companyName} />
              <Row label="Position" value={application.positionTitle} />
              <Row label="Job ID" value={application.jobId ?? '—'} />
              <Row
                label="Job URL"
                value={
                  application.jobUrl ? (
                    <a
                      href={application.jobUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-[var(--color-accent-600)] hover:underline"
                    >
                      {application.jobUrl}
                    </a>
                  ) : (
                    '—'
                  )
                }
              />
              {/* Descriptive only — never compared against candidate location. */}
              <Row label="Job location" value={application.jobLocation ?? '—'} />
              <Row label="Application date" value={formatDate(application.applicationDate)} />
              <Row label="Recorded by" value={application.createdByName ?? 'Unknown'} />
              <Row label="Recorded at" value={formatDateTime(application.createdAt)} />
              {application.notes ? (
                <Row
                  label="Notes"
                  value={<span className="whitespace-pre-wrap">{application.notes}</span>}
                />
              ) : null}
            </dl>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-4">
          {canEdit ? (
            <StatusChanger
              applicationId={application.id}
              currentStatus={application.status}
            />
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Status history</CardTitle>
            </CardHeader>
            <CardBody>
              <ol className="flex flex-col">
                {application.statusHistory.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-col gap-1 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0 first:pt-0"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ApplicationStatusBadge status={h.toStatus} />
                      {h.fromStatus ? (
                        <span className="text-[12px] text-[var(--text-muted)]">
                          from {h.fromStatus}
                        </span>
                      ) : (
                        <span className="text-[12px] text-[var(--text-muted)]">opened</span>
                      )}
                    </div>
                    {h.note ? (
                      <p className="text-[13px] text-[var(--text-secondary)]">{h.note}</p>
                    ) : null}
                    <p className="tabular text-[12px] text-[var(--text-muted)]">
                      {formatDateTime(h.changedAt)}
                      {h.changedByName ? ` · ${h.changedByName}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity on this application</CardTitle>
        </CardHeader>
        <CardBody>
          {activities.length === 0 ? (
            <p className="text-[13px] text-[var(--text-muted)]">
              No activity recorded against this application yet.
            </p>
          ) : (
            <ul className="flex flex-col">
              {activities.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] py-2.5 last:border-b-0 first:pt-0"
                >
                  <ActivityTypeBadge type={a.activityType} />
                  <span className="min-w-0 flex-1 text-[13.5px] text-[var(--text-primary)]">
                    {a.summary ?? '—'}
                  </span>
                  <span className="tabular text-[12px] text-[var(--text-muted)]">
                    {formatDateTime(a.activityDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
