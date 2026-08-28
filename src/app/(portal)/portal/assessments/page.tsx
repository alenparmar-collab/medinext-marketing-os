import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Assessments' };

export default async function Page() {
  await requireCandidate();
  return (
    <ComingSoon
      title="Assessments"
      description="Tests and assessments assigned to you."
      plannedIn="Build 4"
      willInclude={['What is due and by when', 'Your result once it is released']}
    />
  );
}
