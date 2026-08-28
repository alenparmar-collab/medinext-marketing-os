import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type { AssignmentCreateInput, AssignmentEndInput } from './schemas';

export async function createAssignment(
  input: AssignmentCreateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidate_assignments')
    .insert({
      candidate_id: input.candidateId,
      business_unit_id: input.businessUnitId,
      user_id: input.userId,
      assignment_type: input.assignmentType,
      starts_on: input.startsOn ?? new Date().toISOString().slice(0, 10),
      created_by: actor.userId,
    })
    .select('id')
    .single();

  if (error) {
    if (typeof error === 'object' && 'code' in error && error.code === '23505') {
      throw new AppError(
        'CONFLICT',
        'That person is already assigned to this candidate in that capacity, ' +
          'or the candidate already has a primary recruiter.',
      );
    }
    throw error;
  }
  if (!data) throw new AppError('INTERNAL', 'Assignment was not created.');
  return { id: data.id };
}

/**
 * Ends an assignment. The row is retained — assignments are a history, not a
 * pointer, and "who owned this candidate when X happened" must stay answerable.
 * Access is revoked immediately because every policy tests `ends_on is null`.
 */
export async function endAssignment(
  input: AssignmentEndInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidate_assignments')
    .update({
      ends_on: new Date().toISOString().slice(0, 10),
      ended_by: actor.userId,
    })
    .eq('id', input.assignmentId)
    .is('ends_on', null)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Assignment not found, already ended, or not permitted.');
  return { id: data.id };
}
