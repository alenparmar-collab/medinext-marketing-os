import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { ComingSoon } from '@/components/patterns/coming-soon';

export const metadata: Metadata = { title: 'Notifications' };

export default async function Page() {
  await requireInternal();
  return (
    <ComingSoon
      title="Notifications"
      description="In-app notifications for the activity that concerns you."
      plannedIn="Build 4"
      willInclude={['Unread count and inbox', 'Deduplicated by event', 'Delivery records ready for an email channel later']}
    />
  );
}
