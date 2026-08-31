'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { ASSESSMENT_STATUSES_ORDERED, ASSESSMENT_STATUS_META } from '@/config/statuses';
import type { AssessmentStatus } from '@/config/statuses';
import { setAssessmentStatusAction } from '../../interviews/actions';

/**
 * Completion and outcome are one action, because they are one event.
 *
 * `completed_at` is set by the database when the status moves to a closed one,
 * so this panel never sends a completion timestamp: a hand-typed completion
 * date that disagrees with the status change is exactly the kind of drift the
 * derived-records rule exists to prevent.
 */
export function AssessmentOutcomePanel({
  assessmentId,
  currentStatus,
  currentOutcome,
}: {
  assessmentId: string;
  currentStatus: AssessmentStatus;
  currentOutcome: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const options = ASSESSMENT_STATUSES_ORDERED.filter((s) => s !== currentStatus);
  const [status, setStatus] = useState<string>(options[0] ?? 'completed');

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);
    setBusy(true);

    const result = await setAssessmentStatusAction({
      assessmentId,
      status,
      outcome: formData.get('outcome'),
    });

    setBusy(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      if (!result.fieldErrors) setFormError(`${result.message} Reference: ${result.requestId}`);
      return;
    }

    startTransition(() => router.refresh());
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-3" noValidate>
      <Field label="Move to" htmlFor="status" error={errors.status}>
        <Select name="status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {options.map((s) => (
            <option key={s} value={s}>
              {ASSESSMENT_STATUS_META[s].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Outcome"
        htmlFor="outcome"
        error={errors.outcome}
        hint="Short result, e.g. a score or a one-line verdict."
      >
        <Input name="outcome" defaultValue={currentOutcome ?? ''} />
      </Field>

      {formError ? (
        <p role="alert" className="text-[13px] text-[var(--color-critical)]">
          {formError}
        </p>
      ) : null}

      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Update assessment'}
        </Button>
      </div>
    </form>
  );
}
