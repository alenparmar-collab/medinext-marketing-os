'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/field';
import {
  APPLICATION_STATUSES_ORDERED,
  APPLICATION_STATUS_META,
  type ApplicationStatus,
} from '@/config/statuses';
import { changeApplicationStatusAction } from '../actions';

/**
 * Status change is its own action, not a field on the edit form.
 *
 * It is the transition the business cares about, and the database turns it into
 * a history row and a timeline activity. Burying it in a general save would
 * make a significant event look like editing a field.
 *
 * No optimistic update: a status that flips and silently reverts is worse than
 * a short wait, because it destroys trust in what the screen says.
 */
export function StatusChanger({
  applicationId,
  currentStatus,
}: {
  applicationId: string;
  currentStatus: ApplicationStatus;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ApplicationStatus>(currentStatus);

  async function onSubmit(formData: FormData) {
    setError(null);
    setBusy(true);

    const result = await changeApplicationStatusAction({
      applicationId,
      status,
      note: formData.get('note'),
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    startTransition(() => router.refresh());
  }

  const unchanged = status === currentStatus;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change status</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={onSubmit} className="flex flex-col gap-3">
          <Field label="New status" htmlFor="status">
            <Select
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
            >
              {APPLICATION_STATUSES_ORDERED.map((s) => (
                <option key={s} value={s}>
                  {APPLICATION_STATUS_META[s].label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Note"
            htmlFor="note"
            hint="Optional. Kept with this transition in the status history."
          >
            <Textarea name="note" rows={2} />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] border border-[var(--color-critical)]/30 bg-[var(--color-critical-bg)] px-3 py-2 text-[13px] text-[var(--color-critical)]"
            >
              {error}
            </p>
          ) : null}

          <div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy || unchanged}>
              {busy ? 'Updating…' : 'Update status'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
