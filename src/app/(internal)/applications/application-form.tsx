'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { APPLICATION_STATUSES_ORDERED, APPLICATION_STATUS_META } from '@/config/statuses';
import { createApplicationAction, updateApplicationAction } from './actions';

export interface CandidateOption {
  id: string;
  label: string;
}

export interface ApplicationFormValues {
  applicationId?: string;
  candidateId?: string;
  companyName?: string;
  positionTitle?: string;
  applicationDate?: string;
  status?: string;
  jobId?: string | null;
  jobUrl?: string | null;
  jobLocation?: string | null;
  notes?: string | null;
}

/**
 * Required: candidate, company, position, application date, status.
 * Optional: job ID, job URL, job location, notes.
 *
 * On edit the candidate and status are fixed: moving an application between
 * candidates would rewrite history, and status has its own action because it
 * writes a history row and a timeline activity.
 */
export function ApplicationForm({
  mode,
  candidates,
  values,
}: {
  mode: 'create' | 'edit';
  candidates: CandidateOption[];
  values?: ApplicationFormValues;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState(values?.candidateId ?? candidates[0]?.id ?? '');

  const today = new Date().toISOString().slice(0, 10);

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);
    setBusy(true);

    const common = {
      companyName: formData.get('companyName'),
      positionTitle: formData.get('positionTitle'),
      applicationDate: formData.get('applicationDate'),
      jobId: formData.get('jobId'),
      jobUrl: formData.get('jobUrl'),
      jobLocation: formData.get('jobLocation'),
      notes: formData.get('notes'),
    };

    const result =
      mode === 'create'
        ? await createApplicationAction({
            ...common,
            candidateId,
            status: formData.get('status'),
            marketingPeriodId: null,
          })
        : await updateApplicationAction({ ...common, applicationId: values?.applicationId });

    setBusy(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      if (!result.fieldErrors) setFormError(`${result.message} Reference: ${result.requestId}`);
      return;
    }

    const target =
      mode === 'create'
        ? `/applications/${(result.data as { id: string }).id}`
        : `/applications/${values?.applicationId}`;

    startTransition(() => {
      router.push(target);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4" noValidate>
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {mode === 'create' ? (
            <Field label="Candidate" htmlFor="candidateId" error={errors.candidateId} required>
              <Select
                name="candidateId"
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
                required
              >
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Company" htmlFor="companyName" error={errors.companyName} required>
            <Input name="companyName" defaultValue={values?.companyName ?? ''} required />
          </Field>

          <Field label="Position" htmlFor="positionTitle" error={errors.positionTitle} required>
            <Input name="positionTitle" defaultValue={values?.positionTitle ?? ''} required />
          </Field>

          <Field
            label="Application date"
            htmlFor="applicationDate"
            error={errors.applicationDate}
            required
          >
            <Input
              name="applicationDate"
              type="date"
              defaultValue={values?.applicationDate ?? today}
              required
            />
          </Field>

          {mode === 'create' ? (
            <Field label="Status" htmlFor="status" error={errors.status} required>
              <Select name="status" defaultValue={values?.status ?? 'submitted'}>
                {APPLICATION_STATUSES_ORDERED.map((s) => (
                  <option key={s} value={s}>
                    {APPLICATION_STATUS_META[s].label}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Job ID" htmlFor="jobId" error={errors.jobId}>
            <Input name="jobId" defaultValue={values?.jobId ?? ''} />
          </Field>

          {/*
            Descriptive only. Nothing in this product compares a job location
            against the candidate's current or preferred location.
          */}
          <Field
            label="Job location"
            htmlFor="jobLocation"
            error={errors.jobLocation}
            hint="Information about the job. Not compared against the candidate's location."
          >
            <Input name="jobLocation" defaultValue={values?.jobLocation ?? ''} />
          </Field>

          <Field
            label="Job URL"
            htmlFor="jobUrl"
            error={errors.jobUrl}
            className="sm:col-span-2"
            hint="Full URL, starting with https://"
          >
            <Input name="jobUrl" type="url" defaultValue={values?.jobUrl ?? ''} />
          </Field>

          <Field label="Notes" htmlFor="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea name="notes" rows={3} defaultValue={values?.notes ?? ''} />
          </Field>
        </CardBody>
      </Card>

      {formError ? (
        <p
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-critical)]/30 bg-[var(--color-critical-bg)] px-3 py-2 text-[13px] text-[var(--color-critical)]"
        >
          {formError}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create application' : 'Save changes'}
        </Button>
        <Button asChild variant="ghost">
          <Link
            href={
              mode === 'edit' && values?.applicationId
                ? `/applications/${values.applicationId}`
                : '/applications'
            }
          >
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}
