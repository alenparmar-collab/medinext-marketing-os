import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Activity' };

export default async function Page() {
  await requireCandidate();
  return (
    <ComingSoon
      title="Activity"
      description="A chronological record of what has happened."
      plannedIn="Build 4"
      willInclude={['Your marketing periods and their changes', 'Applications, interviews and outcomes as they are added']}
    />
  );
}
