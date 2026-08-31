'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { uploadOwnDocumentAction } from './actions';

/**
 * Candidate upload.
 *
 * The accepted types and the size limit are stated up front rather than
 * discovered by a rejection — this is someone on a phone, possibly on a poor
 * connection, and a failed 20 MB upload is a genuinely bad experience.
 */
const ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';

export function UploadForm({
  documentTypes,
}: {
  documentTypes: { code: string; label: string }[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setErrors({});
    setMessage(null);
    setBusy(true);

    const result = await uploadOwnDocumentAction(formData);
    setBusy(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      if (!result.fieldErrors) setMessage(result.message);
      return;
    }

    formRef.current?.reset();
    setMessage('Uploaded. Your recruiter can see it now.');
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a document</CardTitle>
      </CardHeader>
      <CardBody>
        <form ref={formRef} action={onSubmit} className="flex flex-col gap-3" noValidate>
          <Field label="What is it?" htmlFor="documentType" error={errors.documentType} required>
            <Select name="documentType" defaultValue={documentTypes[0]?.code ?? 'resume'}>
              {documentTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="File"
            htmlFor="file"
            error={errors.file ?? errors.mimeType ?? errors.sizeBytes ?? errors.fileName}
            hint="PDF, Word, PNG or JPEG. Up to 25 MB."
            required
          >
            <input
              id="file"
              name="file"
              type="file"
              accept={ACCEPT}
              required
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-[14px] text-[var(--text-primary)] file:mr-3 file:rounded-[var(--radius-xs)] file:border-0 file:bg-[var(--surface-sunken)] file:px-2.5 file:py-1 file:text-[13px] file:text-[var(--text-primary)]"
            />
          </Field>

          {message ? (
            <p
              role="status"
              className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-3 py-2 text-[13px] text-[var(--text-secondary)]"
            >
              {message}
            </p>
          ) : null}

          <div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy}>
              {busy ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
