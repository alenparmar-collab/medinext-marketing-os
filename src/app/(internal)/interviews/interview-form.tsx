'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { INTERVIEW_STATUSES, INTERVIEW_STATUS_META } from '@/config/statuses';
import { createInterviewAction, updateInterviewAction } from './actions';

export interface ApplicationOption {
  id: string;
  label: string;
}

export interface InterviewFormValues {
  interviewId?: string;
  applicationId?: string;
  interviewRound?: number;
  scheduledAt?: string | null;
  timeZone?: string | null;
  meetingUrl?: string | null;
  interviewerName?: string | null;
  interviewerEmail?: string | null;
  notes?: string | null;
}

/**
 * The candidate is never a field on this form.
 *
 * An interview belongs to the candidate that owns the application, so picking
 * the application picks the candidate. Offering both would let the two
 * disagree, and the composite foreign key would then reject the write with a
 * message no recruiter could act on.
 *
 * On edit, the time is also absent: rescheduling writes history and notifies
 * the candidate, so it is its own action rather than a field in a save.
 */
export function InterviewForm({
  mode,
  applications,
  values,
}: {
  mode: 'create' | 'edit';
  applications: ApplicationOption[];
  values?: InterviewFormValues;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [applicationId, setApplicationId] = useState(
    values?.applicationId ?? applications[0]?.id ?? '',
  );

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);
    setBusy(true);

    const common = {
      interviewRound: formData.get('interviewRound'),
      meetingUrl: formData.get('meetingUrl'),
      interviewerName: formData.get('interviewerName'),
      notes: formData.get('notes'),
    };

    const result =
      mode === 'create'
        ? await createInterviewAction({
            ...common,
            applicationId,
            scheduledAt: formData.get('scheduledAt'),
            timeZone: formData.get('timeZone'),
            interviewerEmail: formData.get('interviewerEmail'),
            status: formData.get('status'),
          })
        : await updateInterviewAction({ ...common, interviewId: values?.interviewId });

    setBusy(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      if (!result.fieldErrors) setFormError(`${result.message} Reference: ${result.requestId}`);
      return;
    }

    const target =
      mode === 'create'
        ? `/interviews/${(result.data as { id: string }).id}`
        : `/interviews/${values?.interviewId}`;

    startTransition(() => {
      router.push(target);
      router.refresh();
    });
  }

  if (applications.length === 0 && mode === 'create') {
    return (
      <Card>
        <CardBody>
          <p className="text-[14px] text-[var(--text-secondary)]">
            An interview is scheduled against an application. Record the application first, then
            come back here.
          </p>
          <Button asChild variant="secondary" size="sm" className="mt-3">
            <Link href="/applications/new">Record an application</Link>
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4" noValidate>
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {mode === 'create' ? (
            <Field
              label="Application"
              htmlFor="applicationId"
              error={errors.applicationId}
              hint="The candidate is taken from the application."
              required
              className="sm:col-span-2"
            >
              <Select
                name="applicationId"
                value={applicationId}
                onChange={(e) => setApplicationId(e.target.value)}
                required
              >
                {applications.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Round" htmlFor="interviewRound" error={errors.interviewRound} required>
            <Input
              name="interviewRound"
              type="number"
              min={1}
              max={20}
              defaultValue={values?.interviewRound ?? 1}
              required
            />
          </Field>

          {mode === 'create' ? (
            <>
              <Field
                label="Date and time"
                htmlFor="scheduledAt"
                error={errors.scheduledAt}
                required
              >
                <Input name="scheduledAt" type="datetime-local" required />
              </Field>

              <Field
                label="Time zone"
                htmlFor="timeZone"
                error={errors.timeZone}
                hint="The zone the time above is in, e.g. Europe/London. Blank means your own."
              >
                <Input name="timeZone" defaultValue={values?.timeZone ?? ''} />
              </Field>

              <Field label="Status" htmlFor="status" error={errors.status}>
                <Select name="status" defaultValue="scheduled">
                  {INTERVIEW_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {INTERVIEW_STATUS_META[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}

          <Field label="Interviewer" htmlFor="interviewerName" error={errors.interviewerName}>
            <Input name="interviewerName" defaultValue={values?.interviewerName ?? ''} />
          </Field>

          {mode === 'create' ? (
            <Field
              label="Interviewer email"
              htmlFor="interviewerEmail"
              error={errors.interviewerEmail}
            >
              <Input name="interviewerEmail" type="email" />
            </Field>
          ) : null}

          <Field
            label="Meeting link"
            htmlFor="meetingUrl"
            error={errors.meetingUrl}
            hint="Full URL, starting with https://"
            className="sm:col-span-2"
          >
            <Input name="meetingUrl" defaultValue={values?.meetingUrl ?? ''} />
          </Field>

          <Field
            label="Notes"
            htmlFor="notes"
            error={errors.notes}
            hint="Internal. The candidate does not see this."
            className="sm:col-span-2"
          >
            <Textarea name="notes" rows={4} defaultValue={values?.notes ?? ''} />
          </Field>
        </CardBody>
      </Card>

      {formError ? (
        <p role="alert" className="text-[13px] text-[var(--color-critical)]">
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : mode === 'create' ? 'Schedule interview' : 'Save changes'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={mode === 'create' ? '/interviews' : `/interviews/${values?.interviewId}`}>
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}
