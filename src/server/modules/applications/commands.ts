import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type { ApplicationRow } from '@/types/database';
import { resolveCandidateBusinessUnit } from '@/server/modules/candidates/tenancy';
import {
  MANUAL_PROVENANCE,
  provenanceColumns,
  type CommandProvenance,
} from '@/server/modules/provenance';
import type {
  ApplicationCreateInput,
  ApplicationStatusChangeInput,
  ApplicationUpdateInput,
} from './schemas';

/**
 * Writes go through the user-scoped client so RLS applies. A command that
 * "works" only under the service role is a command whose policy is wrong.
 *
 * Note what these functions do NOT do: create status-history rows or activity
 * records. Database triggers do that on every insert and every status change,
 * so the aggregation source stays complete regardless of which code path — or
 * which future pipeline — performed the write.
 */
/**
 * `provenance` defaults to manual, so every existing caller is unchanged. The
 * decision engine passes email provenance instead — same command, same
 * validation, same RLS, same triggers, honest source columns.
 */
export async function createApplication(
  input: ApplicationCreateInput,
  actor: ActorContext,
  provenance: CommandProvenance = MANUAL_PROVENANCE,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  // Read from the candidate rather than accepting it from the form.
  const businessUnitId = await resolveCandidateBusinessUnit(input.candidateId);

  const { data, error } = await supabase
    .from('applications')
    .insert({
      candidate_id: input.candidateId,
      business_unit_id: businessUnitId,
      marketing_period_id: input.marketingPeriodId ?? null,
      company_name: input.companyName,
      position_title: input.positionTitle,
      application_date: input.applicationDate,
      status: input.status,
      job_id: input.jobId ?? null,
      job_url: input.jobUrl ?? null,
      job_location: input.jobLocation ?? null,
      notes: input.notes ?? null,
      // Manual by default; a record written from an email says so, and says
      // whether a person confirmed it.
      ...provenanceColumns(provenance, actor.userId),
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!data) throw new AppError('INTERNAL', 'Application was not created.');
  return { id: data.id };
}

export async function updateApplication(
  input: ApplicationUpdateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  // Only send fields the caller actually supplied, so a partial form cannot
  // blank out columns it never rendered.
  const patch: Partial<ApplicationRow> = { updated_by: actor.userId };
  const assign = <K extends keyof ApplicationRow>(key: K, value: ApplicationRow[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };

  assign('company_name', input.companyName);
  assign('position_title', input.positionTitle);
  assign('application_date', input.applicationDate);
  assign('job_id', input.jobId);
  assign('job_url', input.jobUrl);
  assign('job_location', input.jobLocation);
  assign('notes', input.notes);

  const { data, error } = await supabase
    .from('applications')
    .update(patch)
    .eq('id', input.applicationId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  // Zero rows means RLS filtered the update out — not an application bug.
  if (!data) throw new AppError('NOT_FOUND', 'Application not found or not permitted.');
  return { id: data.id };
}

/**
 * A status change is its own operation, performed through an RPC.
 *
 * Two writes have to happen together — the application row, and the history row
 * the trigger derives from it, carrying the optional note. supabase-js cannot
 * span a transaction across two calls, and the history table has no UPDATE
 * policy because history that can be edited is not history. The function is
 * SECURITY INVOKER, so RLS still filters it exactly as a direct query would.
 */
export async function changeApplicationStatus(
  input: ApplicationStatusChangeInput,
  _actor: ActorContext,
): Promise<{ id: string; status: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc('change_application_status', {
    p_application_id: input.applicationId,
    p_status: input.status,
    p_note: input.note ?? null,
  });

  if (error) throw error;

  return { id: input.applicationId, status: String(data ?? input.status) };
}
