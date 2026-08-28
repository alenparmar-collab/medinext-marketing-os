import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Interviews' };

export default async function Page() {
  await requireCandidate();
  return (
    <ComingSoon
      title="Interviews"
      description="Interviews arranged for you."
      plannedIn="Build 4"
      willInclude={['Date and time in your own time zone, always labelled', 'How to join, and who you will meet']}
    />
  );
}
