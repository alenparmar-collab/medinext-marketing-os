import type { Metadata } from 'next';
import { requireCandidate } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Notifications' };

export default async function Page() {
  await requireCandidate();
  return (
    <ComingSoon
      title="Notifications"
      description="Updates about your job search."
      plannedIn="Build 4"
      willInclude={['Interview scheduled, rescheduled or cancelled', 'Assessment assigned', 'A document shared with you']}
    />
  );
}
