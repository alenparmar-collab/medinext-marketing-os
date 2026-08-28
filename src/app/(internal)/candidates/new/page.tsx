import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getActor, can } from '@/server/auth/actor';
import { listBusinessUnits } from '@/server/modules/reference/queries';
import { PageHeader } from '@/components/patterns/page-header';
import { UnauthorizedState } from '@/components/patterns/states';
import { CandidateForm } from './candidate-form';

export const metadata: Metadata = { title: 'Add candidate' };

export default async function NewCandidatePage() {
  const actor = await getActor();
  if (!actor) redirect('/sign-in');

  // The database would refuse the insert anyway; this just avoids showing a
  // form that cannot succeed.
  if (!can(actor, 'candidate.create')) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Add candidate" />
        <UnauthorizedState body="Adding candidates is restricted to managers and administrators. Ask one of them to create the record, then it can be assigned to you." />
      </div>
    );
  }

  const units = await listBusinessUnits();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Add candidate"
        description="Only a name, email and business unit are required. Everything else can be filled in later."
      />
      <CandidateForm units={units} />
    </div>
  );
}
