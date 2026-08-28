'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils/format';
import { createNoteAction, updateNoteAction } from './actions';
import type { InternalNote } from '@/server/modules/notes';

/**
 * Internal notes.
 *
 * The "Internal only" label is not decoration: staff need to know, at the point
 * of writing, that this text is invisible to the candidate — and equally that
 * everything else on the screen may not be.
 *
 * Editing is allowed for the author only. The audit trigger records the old and
 * new body on every edit, so the original wording remains recoverable even
 * though the row changes in place.
 */
export function NotesPanel({
  candidateId,
  notes,
  canWrite,
}: {
  candidateId: string;
  notes: InternalNote[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function onCreate(formData: FormData) {
    setError(null);
    setBusy(true);
    const result = await createNoteAction({
      candidateId,
      body: formData.get('body'),
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.fieldErrors?.body?.join('. ') ?? result.message);
      return;
    }
    startTransition(() => router.refresh());
  }

  async function onUpdate(noteId: string, formData: FormData) {
    setError(null);
    setBusy(true);
    const result = await updateNoteAction({ noteId, body: formData.get('body') });
    setBusy(false);

    if (!result.ok) {
      setError(result.fieldErrors?.body?.join('. ') ?? result.message);
      return;
    }
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal notes</CardTitle>
        <Badge tone="muted">Never shown to the candidate</Badge>
      </CardHeader>
      <CardBody>
        {canWrite ? (
          <form action={onCreate} className="mb-4 flex flex-col gap-2">
            <label htmlFor="new-note" className="sr-only">
              Add an internal note
            </label>
            <Textarea
              id="new-note"
              name="body"
              rows={3}
              required
              placeholder="Internal commentary — not visible to the candidate."
            />
            <div>
              <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                {busy ? 'Saving…' : 'Add note'}
              </Button>
            </div>
          </form>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mb-3 rounded-[var(--radius-sm)] border border-[var(--color-critical)]/30 bg-[var(--color-critical-bg)] px-3 py-2 text-[13px] text-[var(--color-critical)]"
          >
            {error}
          </p>
        ) : null}

        {notes.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)]">
            No internal notes yet. Anything written here stays between staff.
          </p>
        ) : (
          <ul className="flex flex-col">
            {notes.map((note) => (
              <li
                key={note.id}
                className="border-b border-[var(--border-subtle)] py-3 last:border-b-0 first:pt-0"
              >
                {editingId === note.id ? (
                  <form action={(fd) => onUpdate(note.id, fd)} className="flex flex-col gap-2">
                    <Textarea name="body" rows={3} defaultValue={note.body} required />
                    <div className="flex gap-2">
                      <Button type="submit" variant="secondary" size="sm" disabled={busy}>
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-[13.5px] text-[var(--text-primary)]">
                      {note.body}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-[var(--text-muted)]">
                      <span>{note.authorName}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDateTime(note.createdAt)}</span>
                      {note.isEdited ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>edited</span>
                        </>
                      ) : null}
                      {note.isOwn && canWrite ? (
                        <button
                          type="button"
                          onClick={() => setEditingId(note.id)}
                          className="ml-1 text-[var(--color-accent-600)] hover:underline"
                        >
                          Edit
                        </button>
                      ) : null}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
