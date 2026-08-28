import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Interviews' };

export default async function Page() {
  await requireInternal();
  return (
    <ComingSoon
      title="Interviews"
      description="Interviews scheduled for candidates, including reschedules and cancellations."
      plannedIn="Build 4"
      willInclude={['Schedule view with explicit time zones', 'Reschedule as a first-class action with its own history', 'Outcomes recorded per round']}
    />
  );
}
