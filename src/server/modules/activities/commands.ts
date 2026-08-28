import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import { resolveCandidateBusinessUnit } from '@/server/modules/candidates/tenancy';
import type { ActivityCreateInput } from './schemas';

/**
 * Records an activity a human observed.
 *
 * Visibility is NOT set here. A database trigger derives it from the activity
 * type and forces notes internal regardless of input, so an omission at this
 * call site cannot put internal commentary in front of a candidate.
 */
export async function createActivity(
  input: ActivityCreateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();
  const businessUnitId = await resolveCandidateBusinessUnit(input.candidateId);

  const { data, error } = await supabase
    .from('marketing_activities')
    .insert({
      candidate_id: input.candidateId,
      business_unit_id: businessUnitId,
      application_id: input.applicationId ?? null,
      activity_type: input.activityType as never,
      activity_date: new Date(input.activityDate).toISOString(),
      summary: input.summary,
      details: input.note ? { note: input.note } : {},
      source_type: 'manual',
      // A person recorded this, so a person has verified it.
      verified_at: new Date().toISOString(),
      verified_by: actor.userId,
      created_by: actor.userId,
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!data) throw new AppError('INTERNAL', 'Activity was not recorded.');
  return { id: data.id };
}
