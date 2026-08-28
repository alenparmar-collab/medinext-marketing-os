'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Card, CardBody } from '@/components/ui/card';
import { MARKETING_STATUSES, MARKETING_STATUS_META } from '@/config/statuses';
import { createCandidateAction } from './actions';
import type { BusinessUnitOption } from '@/server/modules/reference/queries';

type FieldErrors = Record<string, string[]>;

export function CandidateForm({ units }: { units: BusinessUnitOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setErrors({});
    setFormError(null);

    const result = await createCandidateAction({
      businessUnitId: formData.get('businessUnitId'),
      fullName: formData.get('fullName'),
      email: formData.get('email'),
      phone: formData.get('phone'),
      primarySkill: formData.get('primarySkill'),
      skills: formData.get('skills'),
      totalExperienceMonths: formData.get('totalExperienceMonths'),
      currentLocation: formData.get('currentLocation'),
      visaStatus: formData.get('visaStatus'),
      education: formData.get('education'),
      certifications: formData.get('certifications'),
      preferredLocations: formData.get('preferredLocations'),
      marketingStatus: formData.get('marketingStatus'),
    });

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      // Field-level problems are shown against the fields; anything else needs
      // a form-level message with the reference id.
      if (!result.fieldErrors) {
        setFormError(`${result.message} Reference: ${result.requestId}`);
      }
      return;
    }

    startTransition(() => {
      router.push(`/candidates/${result.data.id}`);
      router.refresh();
    });
  }

  return (
    <form action={onSubmit} className="flex flex-col gap-4" noValidate>
      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="fullName" error={errors.fullName} required>
            <Input name="fullName" autoComplete="off" required />
          </Field>

          <Field label="Email address" htmlFor="email" error={errors.email} required>
            <Input name="email" type="email" autoComplete="off" required />
          </Field>

          <Field label="Business unit" htmlFor="businessUnitId" error={errors.businessUnitId} required>
            <Select name="businessUnitId" required defaultValue={units[0]?.id ?? ''}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Phone" htmlFor="phone" error={errors.phone}>
            <Input name="phone" autoComplete="off" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Primary skill" htmlFor="primarySkill" error={errors.primarySkill}>
            <Input name="primarySkill" />
          </Field>

          <Field
            label="Experience (months)"
            htmlFor="totalExperienceMonths"
            error={errors.totalExperienceMonths}
            hint="Whole months, e.g. 78 for six and a half years."
          >
            <Input name="totalExperienceMonths" type="number" min={0} max={720} />
          </Field>

          <Field
            label="Skills"
            htmlFor="skills"
            error={errors.skills}
            hint="Comma separated."
            className="sm:col-span-2"
          >
            <Input name="skills" placeholder="Clinical Data Management, SAS, CDISC" />
          </Field>

          <Field label="Current location" htmlFor="currentLocation" error={errors.currentLocation}>
            <Input name="currentLocation" />
          </Field>

          {/*
            OPTIONAL by product rule. The hint says so explicitly so nobody
            treats a blank value as an incomplete record. Nothing in this
            product compares preferred locations against anything else.
          */}
          <Field
            label="Preferred locations"
            htmlFor="preferredLocations"
            error={errors.preferredLocations}
            hint="Optional, one per line. Leaving this empty is perfectly normal."
          >
            <Textarea name="preferredLocations" rows={2} placeholder={'London, UK\nRemote'} />
          </Field>

          <Field label="Visa status" htmlFor="visaStatus" error={errors.visaStatus}>
            <Input name="visaStatus" />
          </Field>

          <Field
            label="Certifications"
            htmlFor="certifications"
            error={errors.certifications}
            hint="Comma separated."
          >
            <Input name="certifications" />
          </Field>

          <Field
            label="Education"
            htmlFor="education"
            error={errors.education}
            className="sm:col-span-2"
          >
            <Textarea name="education" rows={2} />
          </Field>

          <Field label="Marketing status" htmlFor="marketingStatus" error={errors.marketingStatus}>
            <Select name="marketingStatus" defaultValue="onboarding">
              {MARKETING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {MARKETING_STATUS_META[s].label}
                </option>
              ))}
            </Select>
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
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Create candidate'}
        </Button>
        <Button asChild variant="ghost">
          <Link href="/candidates">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
