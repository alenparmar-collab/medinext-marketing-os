import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor, can } from '@/server/auth/actor';
import { listCandidates } from '@/server/modules/candidates/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState, UnauthorizedState } from '@/components/patterns/states';
import { ApplicationForm } from '../application-form';

export const metadata: Metadata = { title: 'Add application' };

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ candidate?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  if (!can(actor, 'application.create')) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Add application" />
        <UnauthorizedState body="Recording applications is not part of your access. Ask a manager to record it, or to widen your permissions." />
      </div>
    );
  }

  const { candidate: preselected } = await searchParams;

  // Only candidates the actor can actually access — RLS decides the list, so a
  // recruiter cannot record an application against someone else's candidate.
  const { items } = await listCandidates({
    includeArchived: false,
    limit: 100,
  });

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Add application" />
        <EmptyState
          title="No candidates available"
          body="You need at least one candidate you can access before you can record an application."
        />
      </div>
    );
  }

  const options = items.map((c) => ({
    id: c.id,
    label: `${c.fullName} (${c.reference})`,
  }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Add application"
        description="Company, position, date and status are required. Everything else is optional."
      />
      <ApplicationForm
        mode="create"
        candidates={options}
        values={preselected ? { candidateId: preselected } : undefined}
      />
    </div>
  );
}
