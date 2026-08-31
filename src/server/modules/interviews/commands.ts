import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type { InterviewRow } from '@/types/database';
import type {
  InterviewCreateInput,
  InterviewRescheduleInput,
  InterviewStatusInput,
  InterviewUpdateInput,
} from './schemas';

/**
 * Resolves the candidate and business unit from the APPLICATION.
 *
 * Neither is accepted from the caller. An interview belongs to whoever owns the
 * application; a client-supplied candidate id could only agree with that or be
 * an attack, and the read happens under RLS so an application the caller cannot
 * reach simply is not found.
 */
async function resolveApplicationContext(
  applicationId: string,
): Promise<{ candidateId: string; businessUnitId: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('applications')
    .select('candidate_id, business_unit_id')
    .eq('id', applicationId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Application not found or not permitted.');

  return { candidateId: data.candidate_id, businessUnitId: data.business_unit_id };
}

/**
 * Creating an interview also produces its mirroring activity, its opening
 * schedule-history row and the candidate's notification — all in database
 * triggers, so this function only has to make the record.
 */
export async function createInterview(
  input: InterviewCreateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();
  const { candidateId, businessUnitId } = await resolveApplicationContext(input.applicationId);

  const { data, error } = await supabase
    .from('interviews')
    .insert({
      candidate_id: candidateId,
      business_unit_id: businessUnitId,
      application_id: input.applicationId,
      interview_round: input.interviewRound,
      scheduled_at: new Date(input.scheduledAt).toISOString(),
      time_zone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      meeting_url: input.meetingUrl ?? null,
      interviewer_name: input.interviewerName ?? null,
      interviewer_email: input.interviewerEmail ?? null,
      status: input.status,
      notes: input.notes ?? null,
      source_type: 'manual',
      // A person recorded this, so a person has verified it.
      verified_at: new Date().toISOString(),
      verified_by: actor.userId,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!data) throw new AppError('INTERNAL', 'Interview was not created.');
  return { id: data.id };
}

export async function updateInterview(
  input: InterviewUpdateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const patch: Partial<InterviewRow> = { updated_by: actor.userId };
  const assign = <K extends keyof InterviewRow>(key: K, value: InterviewRow[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };

  assign('interview_round', input.interviewRound);
  assign('meeting_url', input.meetingUrl);
  assign('interviewer_name', input.interviewerName);
  assign('notes', input.notes);

  const { data, error } = await supabase
    .from('interviews')
    .update(patch)
    .eq('id', input.interviewId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Interview not found or not permitted.');
  return { id: data.id };
}

/**
 * Rescheduling goes through an RPC because the reason has to reach the history
 * trigger, and the history table has no UPDATE policy — history that can be
 * edited is not history. SECURITY INVOKER, so RLS still filters the update.
 */
export async function rescheduleInterview(
  input: InterviewRescheduleInput,
  _actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc('reschedule_interview', {
    p_interview_id: input.interviewId,
    p_scheduled_at: new Date(input.scheduledAt).toISOString(),
    p_time_zone: input.timeZone ?? null,
    p_reason: input.reason ?? null,
  });

  if (error) throw error;
  return { id: input.interviewId };
}

export async function setInterviewStatus(
  input: InterviewStatusInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data: current, error: readError } = await supabase
    .from('interviews')
    .select('id, status')
    .eq('id', input.interviewId)
    .maybeSingle();

  if (readError) throw readError;
  if (!current) throw new AppError('NOT_FOUND', 'Interview not found or not permitted.');
  if (current.status === input.status) {
    throw new AppError('PRECONDITION_FAILED', 'The interview already has that status.');
  }

  const { data, error } = await supabase
    .from('interviews')
    .update({ status: input.status, updated_by: actor.userId })
    .eq('id', input.interviewId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Interview not found or not permitted.');
  return { id: data.id };
}
