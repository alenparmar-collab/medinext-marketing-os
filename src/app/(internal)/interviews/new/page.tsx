import type { Metadata } from 'next';
import { requirePermission } from '@/server/auth/actor';
import { listApplications } from '@/server/modules/applications/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { InterviewForm } from '../interview-form';

export const metadata: Metadata = { title: 'Schedule interview' };

export default async function NewInterviewPage({
  searchParams,
}: {
  searchParams: Promise<{ applicationId?: string }>;
}) {
  // The permission is checked here as well as in the action. This one decides
  // whether the page renders; the action's decides whether the write happens.
  await requirePermission('interview.manage');
  const { applicationId } = await searchParams;

  const applications = await listApplications({ limit: 200 });

  const options = applications.map((a) => ({
    id: a.id,
    label: `${a.candidateName} — ${a.positionTitle} at ${a.companyName}`,
  }));

  // A pre-selected application (arriving from a candidate's page) goes first,
  // so the dropdown opens on the one the recruiter meant.
  const ordered = applicationId
    ? [...options.filter((o) => o.id === applicationId), ...options.filter((o) => o.id !== applicationId)]
    : options;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Schedule an interview"
        description="Interviews are recorded against an application, which is what ties them to a candidate."
      />
      <InterviewForm mode="create" applications={ordered} />
    </div>
  );
}
