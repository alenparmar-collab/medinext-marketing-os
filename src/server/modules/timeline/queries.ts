import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { SourceKind } from '@/config/statuses';

/**
 * The candidate timeline.
 *
 * ONE function serves both audiences. `public.candidate_timeline` is SECURITY
 * INVOKER and reads RLS-protected tables, so an internal user sees everything
 * they may see and a candidate sees only their own candidate_visible entries.
 *
 * There is deliberately no "include internal" parameter: a boolean passed from
 * the caller is exactly the kind of argument that eventually gets passed wrong,
 * and getting it wrong would put internal notes in front of a candidate.
 */
export interface TimelineEntry {
  occurredAt: string;
  entryKind: string;
  entryId: string;
  title: string | null;
  detail: string | null;
  companyName: string | null;
  applicationId: string | null;
  status: string | null;
  sourceType: SourceKind;
  isVerified: boolean;
  actorName: string | null;
}

export async function getCandidateTimeline(candidateId: string): Promise<TimelineEntry[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc('candidate_timeline', {
    p_candidate_id: candidateId,
  });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    occurredAt: row.occurred_at,
    entryKind: row.entry_kind,
    entryId: row.entry_id,
    title: row.title,
    detail: row.detail,
    companyName: row.company_name,
    applicationId: row.application_id,
    status: row.status,
    sourceType: row.source_type,
    isVerified: row.is_verified,
    actorName: row.actor_name,
  }));
}
