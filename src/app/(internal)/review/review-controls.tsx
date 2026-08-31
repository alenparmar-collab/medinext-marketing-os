'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  REVIEW_ITEM_PRIORITIES,
  REVIEW_ITEM_PRIORITY_META,
  REVIEW_ITEM_TYPES,
  REVIEW_ITEM_TYPE_META,
  REVIEW_RESOLUTIONS,
  REVIEW_RESOLUTION_META,
} from '@/config/statuses';
import {
  assignReviewItemAction,
  createReviewItemAction,
  resolveReviewItemAction,
  runReviewChecksAction,
  setReviewItemStatusAction,
} from './actions';

type ActionResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string; requestId?: string; fieldErrors?: Record<string, string[]> };

function useAction() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function run(fn: () => Promise<ActionResult>): Promise<boolean> {
    setErrors({});
    setFormError(null);
    setBusy(true);
    const result = await fn();
    setBusy(false);

    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      if (!result.fieldErrors) {
        setFormError(
          `${result.message}${result.requestId ? ` Reference: ${result.requestId}` : ''}`,
        );
      }
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  return { run, busy, errors, formError };
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[13px] text-[var(--color-critical)]">
      {message}
    </p>
  );
}

/** Runs the deterministic checks on demand. Idempotent by dedupe key. */
export function RunChecksButton() {
  const { run, busy, formError } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void run(() => runReviewChecksAction({}))}
      >
        {busy ? 'Running…' : 'Run checks'}
      </Button>
      <ErrorLine message={formError} />
    </div>
  );
}

export interface AssigneeOption {
  id: string;
  fullName: string;
}

export function AssignControl({
  reviewItemId,
  currentAssignee,
  options,
}: {
  reviewItemId: string;
  currentAssignee: string | null;
  options: AssigneeOption[];
}) {
  const { run, busy, formError } = useAction();
  const [value, setValue] = useState(currentAssignee ?? '');

  return (
    <form
      className="flex flex-col gap-2"
      action={async () => {
        await run(() =>
          assignReviewItemAction({ reviewItemId, assignedTo: value === '' ? null : value }),
        );
      }}
    >
      <Field label="Assigned to" htmlFor="assignedTo">
        <Select
          name="assignedTo"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        >
          <option value="">Nobody yet</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.fullName}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorLine message={formError} />
      <div>
        <Button type="submit" variant="secondary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Update assignment'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Taking an item on, or putting it back.
 *
 * Reopening a closed item clears its resolution, because an open item that
 * still carries "resolved: corrected" is a lie the check constraint would
 * reject anyway.
 */
export function ReviewStatusControl({
  reviewItemId,
  currentStatus,
}: {
  reviewItemId: string;
  currentStatus: string;
}) {
  const { run, busy, formError } = useAction();
  const next = currentStatus === 'in_review' ? 'open' : 'in_review';
  const label = next === 'in_review' ? 'Mark as in review' : 'Put back in the queue';

  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void run(() => setReviewItemStatusAction({ reviewItemId, status: next }))}
      >
        {busy ? 'Saving…' : label}
      </Button>
      <ErrorLine message={formError} />
    </div>
  );
}

/**
 * Closing an item.
 *
 * The note is required by the schema, not just by this form: the record of
 * what was decided is the point of the queue. Neither option here asserts that
 * anybody did anything wrong.
 */
export function ResolveControl({ reviewItemId }: { reviewItemId: string }) {
  const { run, busy, errors, formError } = useAction();
  const [status, setStatus] = useState<'resolved' | 'dismissed'>('resolved');
  const [resolution, setResolution] = useState<string>('corrected');

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      action={async (formData: FormData) => {
        await run(() =>
          resolveReviewItemAction({
            reviewItemId,
            status,
            resolution,
            resolutionNotes: formData.get('resolutionNotes'),
          }),
        );
      }}
    >
      <Field label="Close as" htmlFor="status">
        <Select
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'resolved' | 'dismissed')}
        >
          <option value="resolved">Resolved — something was done</option>
          <option value="dismissed">Dismissed — no change needed</option>
        </Select>
      </Field>

      <Field label="Outcome" htmlFor="resolution" error={errors.resolution}>
        <Select
          name="resolution"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
        >
          {REVIEW_RESOLUTIONS.map((r) => (
            <option key={r} value={r}>
              {REVIEW_RESOLUTION_META[r].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="What you decided"
        htmlFor="resolutionNotes"
        error={errors.resolutionNotes}
        hint="Required. The next person reading this needs to know what was checked."
        required
      >
        <Textarea name="resolutionNotes" rows={3} required />
      </Field>

      <ErrorLine message={formError} />

      <div>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Close item'}
        </Button>
      </div>
    </form>
  );
}

/** Raising something a check does not cover. */
export function CreateReviewItemForm({ candidateId }: { candidateId?: string }) {
  const { run, busy, errors, formError } = useAction();
  const [open, setOpen] = useState(false);
  const [itemType, setItemType] = useState<string>('missing_information');
  const [priority, setPriority] = useState<string>('normal');

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Raise an item
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      action={async (formData: FormData) => {
        const ok = await run(() =>
          createReviewItemAction({
            ...(candidateId ? { candidateId } : {}),
            itemType,
            priority,
            reason: formData.get('reason'),
            detail: formData.get('detail'),
          }),
        );
        if (ok) setOpen(false);
      }}
    >
      <Field label="What kind of thing is it?" htmlFor="itemType" error={errors.itemType}>
        <Select name="itemType" value={itemType} onChange={(e) => setItemType(e.target.value)}>
          {REVIEW_ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {REVIEW_ITEM_TYPE_META[t].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Priority" htmlFor="priority" error={errors.priority}>
        <Select name="priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {REVIEW_ITEM_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {REVIEW_ITEM_PRIORITY_META[p].label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="What should someone look at?"
        htmlFor="reason"
        error={errors.reason}
        hint="Describe what you noticed, not who you think is at fault."
        required
      >
        <Input name="reason" required />
      </Field>

      <Field label="Detail" htmlFor="detail" error={errors.detail}>
        <Textarea name="detail" rows={3} />
      </Field>

      <ErrorLine message={formError} />

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Add to queue'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
