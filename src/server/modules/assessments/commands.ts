import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import {
  MANUAL_PROVENANCE,
  provenanceColumns,
  type CommandProvenance,
} from '@/server/modules/provenance';
import type { AssessmentRow } from '@/types/database';
import { ASSESSMENT_STATUS_META } from '@/config/statuses';
import type {
  AssessmentCreateInput,
  AssessmentStatusInput,
  AssessmentUpdateInput,
} from './schemas';

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

/** See createApplication: `provenance` defaults to manual and is unchanged for existing callers. */
export async function createAssessment(
  input: AssessmentCreateInput,
  actor: ActorContext,
  provenance: CommandProvenance = MANUAL_PROVENANCE,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();
  const { candidateId, businessUnitId } = await resolveApplicationContext(input.applicationId);

  const { data, error } = await supabase
    .from('assessments')
    .insert({
      candidate_id: candidateId,
      business_unit_id: businessUnitId,
      application_id: input.applicationId,
      assessment_type: input.assessmentType,
      assessment_url: input.assessmentUrl ?? null,
      received_at: new Date(input.receivedAt).toISOString(),
      deadline: input.deadline ? new Date(input.deadline).toISOString() : null,
      status: input.status,
      notes: input.notes ?? null,
      ...provenanceColumns(provenance, actor.userId),
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!data) throw new AppError('INTERNAL', 'Assessment was not created.');
  return { id: data.id };
}

export async function updateAssessment(
  input: AssessmentUpdateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const patch: Partial<AssessmentRow> = { updated_by: actor.userId };
  const assign = <K extends keyof AssessmentRow>(key: K, value: AssessmentRow[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };

  // assessment_type is NOT NULL in the schema, so a cleared field means "leave
  // it alone" rather than "set it to null".
  if (input.assessmentType) assign('assessment_type', input.assessmentType);
  assign('assessment_url', input.assessmentUrl);
  assign('deadline', input.deadline ? new Date(input.deadline).toISOString() : input.deadline);
  assign('notes', input.notes);

  const { data, error } = await supabase
    .from('assessments')
    .update(patch)
    .eq('id', input.assessmentId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Assessment not found or not permitted.');
  return { id: data.id };
}

export async function setAssessmentStatus(
  input: AssessmentStatusInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  // Reaching a closed state records when it closed, so "completed" always has
  // a date without the recruiter having to remember to set one.
  const closes = !ASSESSMENT_STATUS_META[input.status].isOpen;

  const { data, error } = await supabase
    .from('assessments')
    .update({
      status: input.status,
      outcome: input.outcome ?? null,
      ...(closes ? { completed_at: new Date().toISOString() } : { completed_at: null }),
      updated_by: actor.userId,
    })
    .eq('id', input.assessmentId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Assessment not found or not permitted.');
  return { id: data.id };
}
