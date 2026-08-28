import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Applications' };

export default async function Page() {
  await requireCandidate();
  return (
    <ComingSoon
      title="Applications"
      description="Roles you have been submitted for."
      plannedIn="Build 4"
      willInclude={['Role, company and date', 'Current status of each application']}
    />
  );
}
