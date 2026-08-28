import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';

/**
 * Resolves a candidate's business unit server-side.
 *
 * Child records must carry the same business_unit_id as their candidate. That
 * value is NEVER accepted from the client: it is read here from the candidate
 * row, under RLS, so a caller cannot supply one at all — correct or otherwise.
 *
 * The composite foreign key would reject a mismatch anyway, but a form field
 * that exists only to be echoed back is a footgun, and its absence is one less
 * thing to validate.
 */
export async function resolveCandidateBusinessUnit(candidateId: string): Promise<string> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidates')
    .select('business_unit_id')
    .eq('id', candidateId)
    .maybeSingle();

  if (error) throw error;
  // Zero rows means RLS filtered it out — the caller may not touch this candidate.
  if (!data) throw new AppError('NOT_FOUND', 'Candidate not found or not permitted.');

  return data.business_unit_id;
}
