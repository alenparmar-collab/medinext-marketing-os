import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import { resolveCandidateBusinessUnit } from '@/server/modules/candidates/tenancy';
import type { NoteCreateInput, NoteUpdateInput } from './schemas';

/**
 * Internal notes.
 *
 * These are never visible to a candidate, and the guarantee does not rest on
 * this file: candidate_internal_notes has no candidate-facing RLS policy at
 * all, so a portal user reading the table gets zero rows.
 *
 * Notes are editable by their author only. Edits are captured by the audit
 * trigger with the old and new body, so the original text is recoverable even
 * though the row itself changes.
 */
export interface InternalNote {
  id: string;
  body: string;
  pinned: boolean;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  isEdited: boolean;
  isOwn: boolean;
}

export async function listInternalNotes(
  candidateId: string,
  actorId: string,
): Promise<InternalNote[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidate_internal_notes')
    .select('id, body, pinned, created_by, created_at, updated_at')
    .eq('candidate_id', candidateId)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  const authorIds = [...new Set(rows.map((r) => r.created_by))];
  const names = new Map<string, string>();

  if (authorIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', authorIds);
    for (const u of users ?? []) names.set(u.id, u.full_name);
  }

  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    pinned: r.pinned,
    authorName: names.get(r.created_by) ?? 'Unknown author',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isEdited: r.updated_at !== r.created_at,
    isOwn: r.created_by === actorId,
  }));
}

export async function createInternalNote(
  input: NoteCreateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();
  const businessUnitId = await resolveCandidateBusinessUnit(input.candidateId);

  const { data, error } = await supabase
    .from('candidate_internal_notes')
    .insert({
      candidate_id: input.candidateId,
      business_unit_id: businessUnitId,
      body: input.body,
      created_by: actor.userId,
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!data) throw new AppError('INTERNAL', 'Note was not saved.');
  return { id: data.id };
}

export async function updateInternalNote(
  input: NoteUpdateInput,
  _actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  // The RLS policy restricts updates to the note's author, so no ownership
  // check is needed here — zero rows means "not yours, or not visible".
  const { data, error } = await supabase
    .from('candidate_internal_notes')
    .update({ body: input.body })
    .eq('id', input.noteId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Note not found, or it is not yours to edit.');
  return { id: data.id };
}
