'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { approveProposalAction, resolveProposalAction } from './actions';

/**
 * The decision controls.
 *
 * Four actions, and the destructive-looking one is not the dangerous one:
 * rejecting creates nothing, approving creates a record in the CRM. So approve
 * carries the confirmation of what it is about to write, shown as FINAL RECORD
 * before the button.
 *
 * Every control is a real button with a real label, reachable by keyboard, and
 * no state is communicated by colour alone — each badge and each field carries
 * words.
 */
export interface EditableField {
  key: string;
  label: string;
  value: string;
  /** Present for a field the reviewer must supply before approving. */
  required?: boolean;
  type?: 'text' | 'date' | 'time' | 'url';
  hint?: string;
}

export function DecisionPanel({
  proposalId,
  status,
  fields,
  canApprove,
  eventLabel,
  sourceLine,
}: {
  proposalId: string;
  status: string;
  fields: EditableField[];
  canApprove: boolean;
  eventLabel: string;
  /** e.g. "Email received 12 September" — where this record came from. */
  sourceLine?: string | undefined;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'ignore' | 'claim'>(null);
  // A last look before a record exists. NOT a second decision engine — it
  // decides nothing and checks nothing; it reads back what the server was
  // already going to write, because "create an interview" is the one action on
  // this page that another person can see afterwards.
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const isOpen = status === 'open' || status === 'in_review';

  const finalValue = (field: EditableField) => corrections[field.key] ?? field.value;
  const changed = fields.filter((f) => corrections[f.key] !== undefined && corrections[f.key] !== f.value);
  const missing = fields.filter((f) => f.required && finalValue(f).trim() === '');

  async function run(
    kind: 'approve' | 'reject' | 'ignore' | 'claim',
    fn: () => Promise<{ ok: boolean; message?: string; requestId?: string }>,
  ) {
    setBusy(kind);
    setError(null);
    const result = await fn();
    setBusy(null);

    if (!result.ok) {
      // A CONFLICT here almost always means somebody else got there first. Say
      // that, rather than showing the raw message and letting the reviewer
      // guess whether they created something.
      const conflict = /already|claimed|being reviewed/i.test(result.message ?? '');
      setError(
        conflict
          ? `${result.message} This usually means another team member claimed or decided it first. Refresh to see the latest status.`
          : `${result.message ?? 'That did not work.'} Reference: ${result.requestId ?? '—'}`,
      );
      setConfirming(false);
      startTransition(() => router.refresh());
      return;
    }
    startTransition(() => router.refresh());
  }

  if (!isOpen) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-[var(--text-secondary)]">
          This proposal has been decided. Decisions are not reversed — a different answer means a
          new reading of the email.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* What approving would write. Shown before the button, not after. */}
      <section aria-labelledby="final-record">
        <div className="flex items-center justify-between gap-2">
          <h3
            id="final-record"
            className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]"
          >
            Final record — {eventLabel}
          </h3>
          {canApprove ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Stop editing' : 'Edit'}
            </Button>
          ) : null}
        </div>

        <dl className="mt-2 flex flex-col gap-2.5">
          {fields.map((field) => {
            const corrected = corrections[field.key] !== undefined && corrections[field.key] !== field.value;
            return (
              <div key={field.key} className="flex flex-col gap-1">
                <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--text-muted)]">
                  {field.label}
                  {field.required ? (
                    <span className="ml-1 text-[var(--color-critical)]" aria-hidden="true">
                      *
                    </span>
                  ) : null}
                </dt>

                {editing ? (
                  <Field label={field.label} htmlFor={`field-${field.key}`} hint={field.hint}>
                    <Input
                      name={field.key}
                      type={field.type === 'url' ? 'text' : (field.type ?? 'text')}
                      defaultValue={field.value}
                      onChange={(e) =>
                        setCorrections((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    />
                  </Field>
                ) : (
                  <dd className="text-[14px] text-[var(--text-primary)]">
                    {finalValue(field).trim() === '' ? (
                      <span className="text-[var(--color-caution)]">Not stated in the email</span>
                    ) : (
                      finalValue(field)
                    )}
                  </dd>
                )}

                {/* AI PROPOSED vs YOUR CORRECTION, never one replacing the other. */}
                {corrected ? (
                  <p className="text-[12px] text-[var(--text-muted)]">
                    Proposed: <span className="line-through">{field.value || '—'}</span> · your
                    correction: <span className="text-[var(--text-primary)]">{corrections[field.key]}</span>
                  </p>
                ) : null}
              </div>
            );
          })}
        </dl>

        {changed.length > 0 ? (
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
            {changed.length} {changed.length === 1 ? 'field' : 'fields'} corrected. The original
            proposal is kept alongside your version.
          </p>
        ) : null}

        {missing.length > 0 ? (
          <p className="mt-2 text-[12.5px] text-[var(--color-caution)]">
            {missing.map((f) => f.label).join(', ')} must be supplied before this can be approved.
            Nothing is assumed on your behalf.
          </p>
        ) : null}
      </section>

      <Field
        label="Notes"
        htmlFor="decision-notes"
        hint="Kept with the decision. Say what you checked."
      >
        <Textarea
          id="decision-notes"
          name="notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {error ? (
        <p role="alert" className="text-[13px] text-[var(--color-critical)]">
          {error}
        </p>
      ) : null}

      {/* THE CONFIRMATION. Plain sentences describing the record about to
          exist, and the email it came from. The server remains authoritative:
          it re-reads the proposal, re-takes the claim and re-checks every
          permission whatever this panel shows. */}
      {confirming ? (
        <section
          aria-labelledby="confirm-approval"
          className="rounded-md border border-[var(--border-strong)] bg-[var(--surface-sunken)] p-4"
        >
          <h3
            id="confirm-approval"
            className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]"
          >
            You are about to create
          </h3>
          <p className="mt-1 text-[15px] font-medium text-[var(--text-primary)]">{eventLabel}</p>

          <dl className="mt-2.5 flex flex-col gap-1.5">
            {fields
              .filter((field) => finalValue(field).trim() !== '')
              .map((field) => (
                <div key={field.key} className="flex flex-wrap gap-x-2 text-[13.5px]">
                  <dt className="text-[var(--text-muted)]">{field.label}:</dt>
                  <dd className="text-[var(--text-primary)]">{finalValue(field)}</dd>
                </div>
              ))}
            {sourceLine ? (
              <div className="flex flex-wrap gap-x-2 text-[13.5px]">
                <dt className="text-[var(--text-muted)]">Source:</dt>
                <dd className="text-[var(--text-primary)]">{sourceLine}</dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void run('approve', () =>
                  approveProposalAction({
                    reviewItemId: proposalId,
                    corrections: Object.fromEntries(
                      changed.map((f) => [f.key, corrections[f.key] as string]),
                    ),
                    notes: notes || null,
                  }),
                )
              }
            >
              {busy === 'approve' ? 'Creating…' : 'Confirm approval'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => setConfirming(false)}
            >
              Back
            </Button>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <Button
            variant="primary"
            size="sm"
            disabled={busy !== null || missing.length > 0}
            onClick={() => setConfirming(true)}
          >
            {changed.length > 0 ? 'Approve with corrections' : 'Approve'}
          </Button>
        ) : (
          <p className="text-[13px] text-[var(--text-secondary)]">
            You can reject or ignore this proposal. Approving it needs permission to create the
            record itself.
          </p>
        )}

        <Button
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void run('reject', () =>
              resolveProposalAction({
                reviewItemId: proposalId,
                status: 'rejected',
                notes: notes || null,
              }),
            )
          }
        >
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void run('ignore', () =>
              resolveProposalAction({
                reviewItemId: proposalId,
                status: 'ignored',
                notes: notes || null,
              }),
            )
          }
        >
          {busy === 'ignore' ? 'Ignoring…' : 'Ignore'}
        </Button>

        {status === 'open' ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void run('claim', () =>
                resolveProposalAction({ reviewItemId: proposalId, status: 'in_review' }),
              )
            }
          >
            {busy === 'claim' ? 'Claiming…' : 'I am looking at this'}
          </Button>
        ) : null}
      </div>

      <p className="text-[12px] text-[var(--text-muted)]">
        Rejecting creates nothing. Approving writes a real record through the same command a
        recruiter uses, under your permissions.
      </p>
    </div>
  );
}
