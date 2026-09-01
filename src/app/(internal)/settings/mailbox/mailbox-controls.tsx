'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { syncMailboxAction, disconnectMailboxAction } from './actions';

interface SyncSummary {
  status: string;
  messagesSeen: number;
  messagesCreated: number;
  messagesUpdated: number;
  error: string | null;
}

/**
 * Sync and disconnect.
 *
 * The result of a sync is reported honestly, including a run that succeeded
 * and found nothing — "0 new" is information, and a button that always says
 * "done" teaches people to stop reading it.
 */
export function MailboxControls({ mailboxId }: { mailboxId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | 'sync' | 'disconnect'>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  async function onSync() {
    setBusy('sync');
    setError(null);
    setSummary(null);

    const result = await syncMailboxAction({ mailboxId });
    setBusy(null);

    if (!result.ok) {
      setError(`${result.message} Reference: ${result.requestId}`);
      return;
    }
    setSummary(result.data as SyncSummary);
    startTransition(() => router.refresh());
  }

  async function onDisconnect() {
    setBusy('disconnect');
    setError(null);

    const result = await disconnectMailboxAction({ mailboxId });
    setBusy(null);
    setConfirmingDisconnect(false);

    if (!result.ok) {
      setError(`${result.message} Reference: ${result.requestId}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={busy !== null} onClick={onSync}>
          {busy === 'sync' ? 'Syncing…' : 'Sync now'}
        </Button>

        {confirmingDisconnect ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== null}
              onClick={onDisconnect}
            >
              {busy === 'disconnect' ? 'Disconnecting…' : 'Yes, disconnect'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirmingDisconnect(false)}
            >
              Keep connected
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy !== null}
            onClick={() => setConfirmingDisconnect(true)}
          >
            Disconnect
          </Button>
        )}
      </div>

      {confirmingDisconnect ? (
        <p className="text-[12.5px] text-[var(--text-secondary)]">
          Disconnecting deletes the stored authorisation. Emails already ingested are kept — they
          are a record of what happened, and disconnecting a mailbox is not a reason to lose it.
        </p>
      ) : null}

      {summary ? (
        <p className="text-[13px] text-[var(--text-secondary)]">
          {summary.status === 'succeeded'
            ? `Sync finished. ${summary.messagesSeen} seen, ${summary.messagesCreated} new, ${summary.messagesUpdated} already held.`
            : `Sync failed: ${summary.error ?? 'no reason recorded'}. The previous sync position was kept.`}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[13px] text-[var(--color-critical)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
