import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type { MarketingPeriodCreateInput, MarketingPeriodUpdateInput } from './schemas';

export async function createMarketingPeriod(
  input: MarketingPeriodCreateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('marketing_periods')
    .insert({
      candidate_id: input.candidateId,
      business_unit_id: input.businessUnitId,
      starts_on: input.startsOn,
      ends_on: input.endsOn ?? null,
      status: input.status,
      objective: input.objective ?? null,
      opened_by: actor.userId,
    })
    .select('id')
    .single();

  if (error) {
    // 23P01 is the exclusion constraint: an overlapping live period already
    // exists. That is a business conflict with a useful message, not a 500.
    if (typeof error === 'object' && 'code' in error && error.code === '23P01') {
      throw new AppError(
        'CONFLICT',
        'This candidate already has a live marketing period covering those dates.',
      );
    }
    throw error;
  }
  if (!data) throw new AppError('INTERNAL', 'Marketing period was not created.');

  return { id: data.id };
}

export async function updateMarketingPeriod(
  input: MarketingPeriodUpdateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const closing = input.status === 'completed' || input.status === 'closed';

  const { data, error } = await supabase
    .from('marketing_periods')
    .update({
      status: input.status,
      ends_on: input.endsOn ?? null,
      objective: input.objective ?? null,
      ...(closing ? { closed_by: actor.userId, closed_at: new Date().toISOString() } : {}),
    })
    .eq('id', input.periodId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Marketing period not found or not permitted.');

  return { id: data.id };
}
