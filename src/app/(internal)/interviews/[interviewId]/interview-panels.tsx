'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { INTERVIEW_STATUSES_ORDERED, INTERVIEW_STATUS_META } from '@/config/statuses';
import type { InterviewStatus } from '@/config/statuses';
import { rescheduleInterviewAction, setInterviewStatusAction } from '../actions';

function useAction() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function run(
    fn: () => Promise<
      | { ok: true; data: unknown }
      | { ok: false; message: string; requestId?: string; fieldErrors?: Record<string, string[]> }
    >,
  ) {
    setErrors({});
    setFormError(null);
    setBusy(true);
    const result = await fn();
    setBusy(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      if (!result.fieldErrors) {
        setFormError(`${result.message}${result.requestId ? ` Reference: ${result.requestId}` : ''}`);
      }
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  return { run, busy, errors, formError };
}

/**
 * Rescheduling is separated from editing on purpose.
 *
 * It preserves the previous time in the schedule history and notifies the
 * candidate, so it asks for a reason and says out loud what it is about to do.
 * Burying it in a save would make an irreversible, candidate-visible change
 * look like a typo correction.
 */
export function ReschedulePanel({
  interviewId,
  currentTimeZone,
}: {
  interviewId: string;
  currentTimeZone: string | null;
}) {
  const { run, busy, errors, formError } = useAction();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Reschedule
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4"
      noValidate
      action={async (formData: FormData) => {
        const ok = await run(() =>
          rescheduleInterviewAction({
            interviewId,
            scheduledAt: formData.get('scheduledAt'),
            timeZone: formData.get('timeZone'),
            reason: formData.get('reason'),
          }),
        );
        if (ok) setOpen(false);
      }}
    >
      <p className="text-[13px] text-[var(--text-secondary)]">
        The previous time is kept in the schedule history, and the candidate is notified.
      </p>

      <Field label="New date and time" htmlFor="scheduledAt" error={errors.scheduledAt} required>
        <Input name="scheduledAt" type="datetime-local" required />
      </Field>

      <Field label="Time zone" htmlFor="timeZone" error={errors.timeZone}>
        <Input name="timeZone" defaultValue={currentTimeZone ?? ''} />
      </Field>

      <Field
        label="Reason"
        htmlFor="reason"
        error={errors.reason}
        hint="Recorded against the change. Say who asked and why."
      >
        <Textarea name="reason" rows={2} />
      </Field>

      {formError ? (
        <p role="alert" className="text-[13px] text-[var(--color-critical)]">
          {formError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Confirm new time'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Recording what happened: completed, passed, failed, no show, cancelled.
 *
 * The current status is excluded from the list — "change it to what it already
 * is" is not an operation, and offering it invites a no-op write that still
 * writes a history row.
 */
export function InterviewOutcomePanel({
  interviewId,
  currentStatus,
}: {
  interviewId: string;
  currentStatus: InterviewStatus;
}) {
  const { run, busy, errors, formError } = useAction();
  const options = INTERVIEW_STATUSES_ORDERED.filter((s) => s !== currentStatus);
  const [status, setStatus] = useState<string>(options[0] ?? 'completed');

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      action={async (formData: FormData) => {
        await run(() =>
          setInterviewStatusAction({
            interviewId,
            status,
            reason: formData.get('reason'),
          }),
        );
      }}
    >
      <Field label="Record outcome" htmlFor="status" error={errors.status}>
        <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {options.map((s) => (
            <option key={s} value={s}>
              {INTERVIEW_STATUS_META[s].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Note" htmlFor="reason" error={errors.reason} hint="Kept with the change.">
        <Textarea name="reason" rows={2} />
      </Field>

      {formError ? (
        <p role="alert" className="text-[13px] text-[var(--color-critical)]">
          {formError}
        </p>
      ) : null}

      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Record outcome'}
        </Button>
      </div>
    </form>
  );
}
