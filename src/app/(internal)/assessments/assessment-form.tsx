'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ASSESSMENT_STATUSES_ORDERED, ASSESSMENT_STATUS_META } from '@/config/statuses';
import { createAssessmentAction, updateAssessmentAction } from '../interviews/actions';

export interface ApplicationOption {
  id: string;
  label: string;
}

export interface AssessmentFormValues {
  assessmentId?: string;
  applicationId?: string;
  assessmentType?: string;
  assessmentUrl?: string | null;
  receivedAt?: string | null;
  deadline?: string | null;
  notes?: string | null;
}

/**
 * As with interviews, the candidate comes from the application rather than
 * from a second dropdown that could disagree with it.
 *
 * `received_at` is fixed after creation: it is when the assessment actually
 * arrived, and moving it later would silently rewrite which day's report the
 * record counts towards.
 */
export function AssessmentForm({
  mode,
  applications,
  values,
}: {
  mode: 'create' | 'edit';
  applications: ApplicationOption[];
  values?: AssessmentFormValues;
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
      assessmentType: formData.get('assessmentType'),
      assessmentUrl: formData.get('assessmentUrl'),
      deadline: formData.get('deadline'),
      notes: formData.get('notes'),
    };

    const result =
      mode === 'create'
        ? await createAssessmentAction({
            ...common,
            applicationId,
            receivedAt: formData.get('receivedAt'),
            status: formData.get('status'),
          })
        : await updateAssessmentAction({ ...common, assessmentId: values?.assessmentId });

    setBusy(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      if (!result.fieldErrors) setFormError(`${result.message} Reference: ${result.requestId}`);
      return;
    }

    const target =
      mode === 'create'
        ? `/assessments/${(result.data as { id: string }).id}`
        : `/assessments/${values?.assessmentId}`;

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
            An assessment is recorded against an application. Record the application first, then
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

          <Field
            label="Assessment"
            htmlFor="assessmentType"
            error={errors.assessmentType}
            hint="What the candidate has been asked to do, e.g. HackerRank, take-home task."
            required
          >
            <Input
              name="assessmentType"
              defaultValue={values?.assessmentType ?? ''}
              required={mode === 'create'}
            />
          </Field>

          {mode === 'create' ? (
            <>
              <Field label="Received" htmlFor="receivedAt" error={errors.receivedAt} required>
                <Input name="receivedAt" type="datetime-local" required />
              </Field>

              <Field label="Status" htmlFor="status" error={errors.status}>
                <Select name="status" defaultValue="pending">
                  {ASSESSMENT_STATUSES_ORDERED.map((s) => (
                    <option key={s} value={s}>
                      {ASSESSMENT_STATUS_META[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}

          <Field
            label="Deadline"
            htmlFor="deadline"
            error={errors.deadline}
            hint="Optional. Leave blank if none was given."
          >
            <Input
              name="deadline"
              type="datetime-local"
              defaultValue={values?.deadline ? values.deadline.slice(0, 16) : ''}
            />
          </Field>

          <Field
            label="Assessment link"
            htmlFor="assessmentUrl"
            error={errors.assessmentUrl}
            hint="Full URL, starting with https://"
            className="sm:col-span-2"
          >
            <Input name="assessmentUrl" defaultValue={values?.assessmentUrl ?? ''} />
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
          {busy ? 'Saving…' : mode === 'create' ? 'Record assessment' : 'Save changes'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={mode === 'create' ? '/assessments' : `/assessments/${values?.assessmentId}`}>
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}
