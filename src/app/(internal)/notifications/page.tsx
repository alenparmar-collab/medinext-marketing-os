import type { Metadata } from 'next';
import { requireInternal } from '@/server/auth/actor';
import { listNotifications } from '@/server/modules/notifications';
import { PageHeader } from '@/components/patterns/page-header';
import { EmptyState } from '@/components/patterns/states';
import { NotificationList } from '@/components/patterns/notification-list';
import {
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from '@/app/notifications-actions';

export const metadata: Metadata = { title: 'Notifications' };

export default async function InternalNotificationsPage() {
  await requireInternal();
  const notifications = await listNotifications(100);

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Notifications"
        description="Updates about the candidates assigned to you."
      />

      {notifications.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          body="You will be notified when an interview is scheduled or moved, an assessment arrives, or an application changes status for one of your candidates."
        />
      ) : (
        <NotificationList
          notifications={notifications}
          audience="internal"
          onMarkRead={markNotificationReadAction}
          onMarkAllRead={markAllNotificationsReadAction}
        />
      )}
    </div>
  );
}
