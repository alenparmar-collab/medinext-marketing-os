import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { NotificationType } from '@/config/statuses';

/**
 * Notifications.
 *
 * There is no create function here, deliberately. Notifications are produced
 * exclusively by database triggers calling util.emit_notification, which is the
 * only thing with rights to write the table. That is what keeps a candidate
 * from generating system notifications, and what makes the same guarantee hold
 * for the email pipeline in a later build without any new code.
 *
 * Everything a caller may do is read their own and mark them read.
 */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

const COLUMNS =
  'id, notification_type, title, message, entity_type, entity_id, read_at, created_at';

export async function listNotifications(limit = 50): Promise<NotificationItem[]> {
  const supabase = await createServerSupabase();

  // No recipient filter: the RLS policy admits only the caller's own rows, and
  // adding a redundant filter here would invite someone to "parameterise" it.
  const { data, error } = await supabase
    .from('notifications')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((n) => ({
    id: n.id,
    type: n.notification_type as NotificationType,
    title: n.title,
    message: n.message,
    entityType: n.entity_type,
    entityId: n.entity_id,
    readAt: n.read_at,
    createdAt: n.created_at,
  }));
}

export async function countUnread(): Promise<number> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.from('notifications').select('id').is('read_at', null);
  if (error) throw error;
  return data?.length ?? 0;
}

export async function markNotificationRead(notificationId: string): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .is('read_at', null)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  // Already read, or not the caller's. Both are fine and both look the same.
  if (!data) return { id: notificationId };
  return { id: data.id };
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .select('id');

  if (error) throw error;
  return { count: data?.length ?? 0 };
}

export async function requireOwnNotification(notificationId: string): Promise<NotificationItem> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('notifications')
    .select(COLUMNS)
    .eq('id', notificationId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Notification not found.');

  return {
    id: data.id,
    type: data.notification_type as NotificationType,
    title: data.title,
    message: data.message,
    entityType: data.entity_type,
    entityId: data.entity_id,
    readAt: data.read_at,
    createdAt: data.created_at,
  };
}
