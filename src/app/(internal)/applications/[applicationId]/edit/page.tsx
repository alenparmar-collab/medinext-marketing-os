import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireInternal, can } from '@/server/auth/actor';
import { getApplication } from '@/server/modules/applications/queries';
import { AppError } from '@/server/auth/errors';
import { PageHeader } from '@/components/patterns/page-header';
import { UnauthorizedState } from '@/components/patterns/states';
import { ApplicationForm } from '../../application-form';

export const metadata: Metadata = { title: 'Edit application' };

export default async function EditApplicationPage({
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

  if (!can(actor, 'application.update')) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Edit application" />
        <UnauthorizedState body="Editing applications is not part of your access." />
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow={application.candidateName}
        title="Edit application"
        description="The candidate cannot be changed, and status has its own action so the change is recorded in history."
      />
      <ApplicationForm
        mode="edit"
        candidates={[]}
        values={{
          applicationId: application.id,
          candidateId: application.candidateId,
          companyName: application.companyName,
          positionTitle: application.positionTitle,
          applicationDate: application.applicationDate,
          status: application.status,
          jobId: application.jobId,
          jobUrl: application.jobUrl,
          jobLocation: application.jobLocation,
          notes: application.notes,
        }}
      />
    </div>
  );
}
