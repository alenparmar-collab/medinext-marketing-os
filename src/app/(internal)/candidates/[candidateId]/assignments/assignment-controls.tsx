'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { ASSIGNMENT_TYPES, ASSIGNMENT_TYPE_LABELS } from '@/config/statuses';
import {
  assignCandidateAction,
  reassignCandidateAction,
  endAssignmentAction,
} from '../actions';

type ActionResult =
  | { ok: true; data: unknown }
  | { ok: false; message: string; requestId?: string; fieldErrors?: Record<string, string[]> };

function useAction() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function run(fn: () => Promise<ActionResult>) {
    setFormError(null);
    setBusy(true);
    const result = await fn();
    setBusy(false);

    if (!result.ok) {
      setFormError(`${result.message}${result.requestId ? ` Reference: ${result.requestId}` : ''}`);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  return { run, busy, formError };
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[13px] text-[var(--color-critical)]">
      {message}
    </p>
  );
}

export interface AssigneeOption {
  id: string;
  fullName: string;
  activeAssignments: number;
}

/**
 * Assigning somebody, or moving the candidate to somebody else.
 *
 * When a primary recruiter already exists the form transfers rather than adds:
 * a candidate has at most one active primary recruiter, enforced by a partial
 * unique index, and the transfer closes the old assignment and opens the new
 * one in a single transaction.
 */
export function AssignForm({
  candidateId,
  businessUnitId,
  options,
  hasPrimary,
}: {
  candidateId: string;
  businessUnitId: string;
  options: AssigneeOption[];
  hasPrimary: boolean;
}) {
  const { run, busy, formError } = useAction();
  const [userId, setUserId] = useState(options[0]?.id ?? '');
  const [assignmentType, setAssignmentType] = useState<string>('primary_recruiter');

  const transferring = hasPrimary && assignmentType === 'primary_recruiter';

  if (options.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-secondary)]">
        There are no active internal accounts available to assign. Candidate portal accounts cannot
        be assigned to a candidate.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      action={async () => {
        await run(() =>
          transferring
            ? reassignCandidateAction({ candidateId, userId, assignmentType })
            : assignCandidateAction({ candidateId, businessUnitId, userId, assignmentType }),
        );
      }}
    >
      <Field label="Person" htmlFor="userId">
        <Select name="userId" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.fullName} · {o.activeAssignments} assigned
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Capacity" htmlFor="assignmentType">
        <Select
          name="assignmentType"
          value={assignmentType}
          onChange={(e) => setAssignmentType(e.target.value)}
        >
          {ASSIGNMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSIGNMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
      </Field>

      {transferring ? (
        <p className="text-[12.5px] text-[var(--text-secondary)]">
          There is already a primary recruiter. Saving will end that assignment and open the new one
          in a single step — the previous assignment is kept in the history.
        </p>
      ) : null}

      <ErrorLine message={formError} />

      <div>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? 'Saving…' : transferring ? 'Transfer candidate' : 'Assign'}
        </Button>
      </div>
    </form>
  );
}

export function EndAssignmentButton({ assignmentId }: { assignmentId: string }) {
  const { run, busy, formError } = useAction();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void run(() => endAssignmentAction({ assignmentId }))}
      >
        {busy ? 'Ending…' : 'End assignment'}
      </Button>
      <ErrorLine message={formError} />
    </div>
  );
}
