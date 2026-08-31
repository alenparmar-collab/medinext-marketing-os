'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { saveDailyReportAction, confirmDailyReportAction } from './actions';

/**
 * The form a recruiter fills in.
 *
 * Note what it does NOT contain: any field for a count. Applications,
 * responses, interviews, assessments and rejections are counted from the
 * records this person created; typing them here would create a second,
 * competing answer, and the schema behind this form has nowhere to put one.
 */
export function DailyReportForm({
  reportId,
  reportDate,
  values,
  canConfirm,
}: {
  reportId: string | null;
  reportDate: string;
  values: { notes: string | null; observations: string | null; exceptions: string | null };
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | 'save' | 'confirm'>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function readFields(formData: FormData) {
    return {
      notes: formData.get('notes'),
      observations: formData.get('observations'),
      exceptions: formData.get('exceptions'),
    };
  }

  async function onSubmit(formData: FormData) {
    const intent = confirming ? 'confirm' : 'save';
    setErrors({});
    setFormError(null);
    setBusy(intent);

    const fields = readFields(formData);

    const result =
      intent === 'confirm' && reportId
        ? await confirmDailyReportAction({ reportId, ...fields })
        : await saveDailyReportAction({ reportDate, ...fields });

    setBusy(null);
    setConfirming(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      if (!result.fieldErrors) setFormError(`${result.message} Reference: ${result.requestId}`);
      return;
    }

    const id = (result.data as { id: string }).id;
    startTransition(() => {
      router.push(`/reports/daily/${id}`);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field
        label="Notes"
        htmlFor="notes"
        error={errors.notes}
        hint="What the figures above do not say. Context, not counts."
      >
        <Textarea name="notes" rows={4} defaultValue={values.notes ?? ''} />
      </Field>

      <Field
        label="Observations"
        htmlFor="observations"
        error={errors.observations}
        hint="Patterns worth someone else knowing — a market shift, a slow client, a promising channel."
      >
        <Textarea name="observations" rows={3} defaultValue={values.observations ?? ''} />
      </Field>

      <Field
        label="Exceptions"
        htmlFor="exceptions"
        error={errors.exceptions}
        hint="Anything that went wrong or is stuck, and what you need to unblock it."
      >
        <Textarea name="exceptions" rows={3} defaultValue={values.exceptions ?? ''} />
      </Field>

      {formError ? (
        <p role="alert" className="text-[13px] text-[var(--color-critical)]">
          {formError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" disabled={busy !== null}>
          {busy === 'save' ? 'Saving…' : 'Save draft'}
        </Button>

        {canConfirm && reportId ? (
          <Button
            type="submit"
            variant="primary"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
          >
            {busy === 'confirm' ? 'Confirming…' : 'Confirm report'}
          </Button>
        ) : null}
      </div>

      {canConfirm && reportId ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Confirming freezes today&apos;s figures onto the report and closes it to further editing.
          The figures are taken from your records at that moment — you are confirming the day, not
          the numbers.
        </p>
      ) : null}
    </form>
  );
}
