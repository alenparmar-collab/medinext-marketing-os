'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { interpretEmailAction } from './actions';

/**
 * Triggers interpretation, and says plainly what it produced.
 *
 * No spinner-and-sparkle, no "AI is thinking". This is an operations tool: it
 * either produced a reading somebody can check, or it did not, and the outcome
 * belongs on screen either way.
 */
export function InterpretButton({
  emailMessageId,
  hasExistingRun,
}: {
  emailMessageId: string;
  hasExistingRun: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onInterpret() {
    setBusy(true);
    setError(null);

    const result = await interpretEmailAction({ emailMessageId });
    setBusy(false);

    if (!result.ok) {
      setError(`${result.message} Reference: ${result.requestId}`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={onInterpret}>
          {busy ? 'Interpreting…' : hasExistingRun ? 'Interpret again' : 'Interpret this email'}
        </Button>
        {hasExistingRun ? (
          <span className="text-[12px] text-[var(--text-muted)]">
            Creates a new reading. The previous one is kept.
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-[13px] text-[var(--color-critical)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
