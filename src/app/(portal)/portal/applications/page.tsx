import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { getMyApplications } from '@/server/modules/portal/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/patterns/states';
import { ApplicationStatusBadge } from '@/components/patterns/status-badge';
import { formatDate } from '@/lib/utils/format';

export const metadata: Metadata = { title: 'Applications' };

/**
 * The candidate's own applications.
 *
 * Scoped by the candidate id on the session, never from the URL. The projection
 * is narrow: no vendor, no internal notes, no recruiter identity, no source or
 * verification metadata.
 *
 * Rendered as cards rather than a dense table — this page is read on a phone
 * between other things, unlike the internal CRM.
 */
export default async function PortalApplicationsPage() {
  const actor = await requireCandidate();
  const applications = await getMyApplications(actor.candidateId);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Applications"
        description="Roles you have been submitted for, newest first."
      />

      {applications.length === 0 ? (
        <EmptyState
          title="No applications yet"
          body="When your recruiter submits you for a role, it will appear here with its current status. There is nothing for you to do in the meantime."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {applications.map((a) => (
            <li key={a.id}>
              <Card>
                <CardBody className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium text-[var(--text-primary)]">
                      {a.positionTitle}
                    </p>
                    <p className="text-[13.5px] text-[var(--text-secondary)]">{a.companyName}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-[var(--text-muted)]">
                      <span>Applied {formatDate(a.applicationDate)}</span>
                      {a.jobLocation ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{a.jobLocation}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <ApplicationStatusBadge status={a.status} />
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
