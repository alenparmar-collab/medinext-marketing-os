import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type { CandidateRow } from '@/types/database';
import type { CandidateCreateInput, CandidateUpdateInput } from './schemas';

/**
 * Writes go through the user-scoped client so RLS applies. A command that
 * "works" only under the service role is a command whose policy is wrong.
 */

export async function createCandidate(
  input: CandidateCreateInput,
  actor: ActorContext,
): Promise<{ id: string; reference: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidates')
    .insert({
      business_unit_id: input.businessUnitId,
      full_name: input.fullName,
      email: input.email,
      phone: input.phone ?? null,
      primary_skill: input.primarySkill ?? null,
      skills: input.skills,
      total_experience_months: input.totalExperienceMonths,
      current_location: input.currentLocation ?? null,
      visa_status: input.visaStatus ?? null,
      education: input.education ?? null,
      certifications: input.certifications,
      preferred_locations: input.preferredLocations,
      marketing_status: input.marketingStatus,
      created_source: 'manual',
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select('id, reference')
    .single();

  if (error) throw error;
  if (!data) throw new AppError('INTERNAL', 'Candidate was not created.');

  return { id: data.id, reference: data.reference };
}

export async function updateCandidate(
  input: CandidateUpdateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  // Only send fields the caller actually supplied, so a partial form cannot
  // blank out columns it never rendered.
  const patch: Partial<CandidateRow> = { updated_by: actor.userId };
  const assign = <K extends keyof CandidateRow>(key: K, value: CandidateRow[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };

  assign('full_name', input.fullName);
  assign('email', input.email);
  assign('phone', input.phone);
  assign('primary_skill', input.primarySkill);
  assign('skills', input.skills);
  assign('total_experience_months', input.totalExperienceMonths);
  assign('current_location', input.currentLocation);
  assign('visa_status', input.visaStatus);
  assign('education', input.education);
  assign('certifications', input.certifications);
  assign('preferred_locations', input.preferredLocations);
  assign('marketing_status', input.marketingStatus);

  const { data, error } = await supabase
    .from('candidates')
    .update(patch)
    .eq('id', input.candidateId)
    .select('id')
    .maybeSingle();

  if (error) throw error;

  // Zero rows means RLS filtered the update out — the caller may not touch this
  // candidate. It is not an application bug.
  if (!data) throw new AppError('NOT_FOUND', 'Candidate not found or not permitted.');

  return { id: data.id };
}

export async function setCandidateArchived(
  input: { candidateId: string; archived: boolean },
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidates')
    .update({
      archived_at: input.archived ? new Date().toISOString() : null,
      updated_by: actor.userId,
    })
    .eq('id', input.candidateId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Candidate not found or not permitted.');

  return { id: data.id };
}
