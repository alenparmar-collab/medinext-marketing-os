'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { MANUAL_ACTIVITY_TYPES, ACTIVITY_TYPE_META, type ActivityType } from '@/config/statuses';
import { createActivityAction } from '../actions';

/**
 * Records something a person observed.
 *
 * Only manually loggable types are offered. `application_submitted` and
 * `status_change` are written by the database when an application is created or
 * moved, so offering them here would let someone log an application that does
 * not exist — and the derived counts would stop matching the records.
 */
export function LogActivityForm({
  candidateId,
  applications,
}: {
  candidateId: string;
  applications: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [type, setType] = useState<ActivityType>('recruiter_response');

  // Lazy state initialiser rather than a call in the render body: reading the
  // clock during render is impure and re-runs on every render. It also has to
  // be client-side, because the default should be the user's local time, not
  // the server's.
  const [nowLocal] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  );

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);
    setBusy(true);

    const result = await createActivityAction({
      candidateId,
      applicationId: formData.get('applicationId'),
      activityType: formData.get('activityType'),
      activityDate: formData.get('activityDate'),
      summary: formData.get('summary'),
      note: formData.get('note'),
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
    <Card>
      <CardHeader>
        <CardTitle>Record activity</CardTitle>
      </CardHeader>
      <CardBody>
        <form action={onSubmit} className="flex flex-col gap-3" noValidate>
          <Field label="What happened" htmlFor="activityType" error={errors.activityType} required>
            <Select
              name="activityType"
              value={type}
              onChange={(e) => setType(e.target.value as ActivityType)}
            >
              {MANUAL_ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACTIVITY_TYPE_META[t].label}
                </option>
              ))}
            </Select>
          </Field>

          {type === 'note' ? (
            <p className="rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]">
              Internal notes are never shown to the candidate.
            </p>
          ) : (
            <p className="rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[12px] text-[var(--text-secondary)]">
              This will appear on the candidate&rsquo;s own timeline.
            </p>
          )}

          <Field label="When" htmlFor="activityDate" error={errors.activityDate} required>
            <Input name="activityDate" type="datetime-local" defaultValue={nowLocal} required />
          </Field>

          <Field label="Summary" htmlFor="summary" error={errors.summary} required>
            <Input name="summary" required maxLength={300} />
          </Field>

          {applications.length > 0 ? (
            <Field
              label="Related application"
              htmlFor="applicationId"
              error={errors.applicationId}
              hint="Optional. Leave blank for activity that is not tied to one application."
            >
              <Select name="applicationId" defaultValue="">
                <option value="">Not related to an application</option>
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Detail" htmlFor="note" error={errors.note}>
            <Textarea name="note" rows={2} />
          </Field>

          {formError ? (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] border border-[var(--color-critical)]/30 bg-[var(--color-critical-bg)] px-3 py-2 text-[13px] text-[var(--color-critical)]"
            >
              {formError}
            </p>
          ) : null}

          <div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy}>
              {busy ? 'Recording…' : 'Record activity'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
