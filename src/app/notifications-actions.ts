'use server';

import { markNotificationRead, markAllNotificationsRead } from '@/server/modules/notifications';
import { getActor } from '@/server/auth/actor';

/**
 * Read-state actions, shared by both experiences.
 *
 * These sit outside the `mutation` pipeline deliberately: they take no
 * permission, because marking your own notification read is not a capability
 * anyone can be denied. RLS already restricts the update to the caller's own
 * rows, so there is nothing for a permission check to add.
 */
export async function markNotificationReadAction(id: string): Promise<{ ok: boolean }> {
  const actor = await getActor();
  if (!actor) return { ok: false };

  try {
    await markNotificationRead(id);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function markAllNotificationsReadAction(): Promise<{ ok: boolean }> {
  const actor = await getActor();
  if (!actor) return { ok: false };

  try {
    await markAllNotificationsRead();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
