import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Assessments' };

export default async function Page() {
  await requireInternal();
  return (
    <ComingSoon
      title="Assessments"
      description="Assessments issued to candidates and their results."
      plannedIn="Build 4"
      willInclude={['Assessment type, platform and due date', 'Submission and result tracking', 'Due-soon queue on the overview']}
    />
  );
}
