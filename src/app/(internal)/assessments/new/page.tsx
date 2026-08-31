import type { Metadata } from 'next';
import { requirePermission } from '@/server/auth/actor';
import { listApplications } from '@/server/modules/applications/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { AssessmentForm } from '../assessment-form';

export const metadata: Metadata = { title: 'Record assessment' };

export default async function NewAssessmentPage({
  searchParams,
}: {
  searchParams: Promise<{ applicationId?: string }>;
}) {
  await requirePermission('assessment.manage');
  const { applicationId } = await searchParams;

  const applications = await listApplications({ limit: 200 });
  const options = applications.map((a) => ({
    id: a.id,
    label: `${a.candidateName} — ${a.positionTitle} at ${a.companyName}`,
  }));

  const ordered = applicationId
    ? [
        ...options.filter((o) => o.id === applicationId),
        ...options.filter((o) => o.id !== applicationId),
      ]
    : options;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Record an assessment"
        description="Assessments are recorded against an application, which is what ties them to a candidate."
      />
      <AssessmentForm mode="create" applications={ordered} />
    </div>
  );
}
