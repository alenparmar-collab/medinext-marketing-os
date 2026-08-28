import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Applications' };

export default async function Page() {
  await requireInternal();
  return (
    <ComingSoon
      title="Applications"
      description="Job applications submitted on behalf of candidates, and the responses they draw."
      plannedIn="Build 4"
      willInclude={['Applications with client, vendor, role and status', 'Recruiter responses linked to an application', 'An append-only status history for every transition']}
    />
  );
}
