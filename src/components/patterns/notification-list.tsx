'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { NOTIFICATION_TYPE_META, notificationHref } from '@/config/statuses';
import { Badge } from '@/components/ui/badge';
import { formatDateTime, formatRelative } from '@/lib/utils/format';
import type { NotificationItem } from '@/server/modules/notifications';

/**
 * The notification centre, shared by both experiences.
 *
 * Marking read is the one place optimistic UI is unambiguously right: it is
 * reversible, single-field, and waiting for a round trip to grey out a row
 * feels broken. Everything else in this product waits for the server.
 *
 * Motion is limited to a colour fade on the unread marker. An entrance
 * animation on a list that changes under the reader is noise.
 */
export function NotificationList({
  notifications,
  audience,
  onMarkRead,
  onMarkAllRead,
}: {
  notifications: NotificationItem[];
  audience: 'internal' | 'portal';
  onMarkRead: (id: string) => Promise<{ ok: boolean }>;
  onMarkAllRead: () => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const isRead = (n: NotificationItem) => n.readAt !== null || readIds.has(n.id);
  const unreadCount = notifications.filter((n) => !isRead(n)).length;

  async function markRead(id: string) {
    setReadIds((prev) => new Set(prev).add(id));
    const result = await onMarkRead(id);
    // Put it back if the server disagreed, rather than showing a lie.
    if (!result.ok) {
      setReadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    startTransition(() => router.refresh());
  }

  async function markAll() {
    setBusy(true);
    setReadIds(new Set(notifications.map((n) => n.id)));
    const result = await onMarkAllRead();
    setBusy(false);
    if (!result.ok) {
      setReadIds(new Set());
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[var(--text-muted)]" aria-live="polite">
          {unreadCount === 0
            ? 'Everything is read'
            : `${unreadCount} unread of ${notifications.length}`}
        </p>
        {unreadCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={markAll} disabled={busy}>
            Mark all read
          </Button>
        ) : null}
      </div>

      <ul className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
        {notifications.map((n) => {
          const read = isRead(n);
          const href = notificationHref(n.entityType, n.entityId, audience);
          const meta = NOTIFICATION_TYPE_META[n.type];

          return (
            <li
              key={n.id}
              className={cn(
                'flex gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0 transition-colors duration-150',
                !read && 'bg-[var(--color-accent-50)]',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1.5 h-2 w-2 shrink-0 rounded-full transition-colors duration-300',
                  read ? 'bg-[var(--border-strong)]' : 'bg-[var(--color-accent-600)]',
                )}
              />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <time
                    dateTime={n.createdAt}
                    title={formatDateTime(n.createdAt)}
                    className="tabular ml-auto text-[12px] text-[var(--text-muted)]"
                  >
                    {formatRelative(n.createdAt)}
                  </time>
                </div>

                <p
                  className={cn(
                    'mt-1 text-[14px]',
                    read
                      ? 'text-[var(--text-secondary)]'
                      : 'font-medium text-[var(--text-primary)]',
                  )}
                >
                  {n.title}
                </p>
                {n.message ? (
                  <p className="text-[13px] text-[var(--text-secondary)]">{n.message}</p>
                ) : null}

                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => !read && void markRead(n.id)}
                      className="text-[13px] text-[var(--color-accent-600)] hover:underline"
                    >
                      Open
                    </Link>
                  ) : null}
                  {!read ? (
                    <button
                      type="button"
                      onClick={() => void markRead(n.id)}
                      className="text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline"
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
