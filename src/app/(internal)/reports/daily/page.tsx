import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Daily Reports' };

export default async function Page() {
  await requireInternal();
  return (
    <ComingSoon
      title="Daily Reports"
      description="Daily recruiter activity reports, pre-populated from the records."
      plannedIn="Build 5"
      willInclude={['Counts derived from verified records', 'Recruiter overrides with a required reason', 'Manager view of team submission status']}
    />
  );
}
