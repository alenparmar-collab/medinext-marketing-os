import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type { DailyReportConfirmInput, DailyReportUpsertInput } from './schemas';

/**
 * Creates or updates the caller's own report for a date.
 *
 * The recruiter id comes from the SESSION, never from the form: a report is
 * always about the person filing it, and the RLS policy enforces that
 * independently.
 *
 * Only judgement fields are written. There is no code path anywhere that sets
 * a count on a report.
 */
export async function upsertOwnDailyReport(
  input: DailyReportUpsertInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  if (!actor.businessUnitId) {
    throw new AppError('PRECONDITION_FAILED', 'Your account is not attached to a business unit.');
  }

  const { data: existing, error: readError } = await supabase
    .from('daily_reports')
    .select('id, status')
    .eq('recruiter_id', actor.userId)
    .eq('report_date', input.reportDate)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    if (existing.status === 'confirmed') {
      throw new AppError(
        'PRECONDITION_FAILED',
        'This report has been confirmed and can no longer be edited.',
      );
    }

    const { data, error } = await supabase
      .from('daily_reports')
      .update({
        notes: input.notes ?? null,
        observations: input.observations ?? null,
        exceptions: input.exceptions ?? null,
      })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new AppError('NOT_FOUND', 'Report not found or not permitted.');
    return { id: data.id };
  }

  const { data, error } = await supabase
    .from('daily_reports')
    .insert({
      business_unit_id: actor.businessUnitId,
      recruiter_id: actor.userId,
      report_date: input.reportDate,
      status: 'draft',
      notes: input.notes ?? null,
      observations: input.observations ?? null,
      exceptions: input.exceptions ?? null,
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!data) throw new AppError('INTERNAL', 'The report was not saved.');
  return { id: data.id };
}

/**
 * Confirmation goes through an RPC because it must freeze the derived figures
 * and flip the status in one transaction, and because the check constraint
 * would reject any half-done version. SECURITY INVOKER, so RLS still decides
 * whether this caller may write this report.
 */
export async function confirmDailyReport(
  input: DailyReportConfirmInput,
  _actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc('confirm_daily_report', {
    p_report_id: input.reportId,
    p_notes: input.notes ?? null,
    p_observations: input.observations ?? null,
    p_exceptions: input.exceptions ?? null,
  });

  if (error) throw error;
  return { id: input.reportId };
}
