import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { MarketingStatus } from '@/config/statuses';

/**
 * Overview counts.
 *
 * Every figure here is produced by an RLS-filtered query, so a recruiter's
 * dashboard counts their candidates and a manager's counts the unit's, with no
 * role branching in this file at all.
 */
export interface OverviewMetrics {
  totalCandidates: number;
  byStatus: { status: MarketingStatus; count: number }[];
  activePeriods: number;
  documentCount: number;
  myActiveAssignments: number;
}

export async function getOverviewMetrics(userId: string): Promise<OverviewMetrics> {
  const supabase = await createServerSupabase();

  const [candidates, periods, documents, assignments] = await Promise.all([
    supabase.from('candidates').select('marketing_status').is('archived_at', null),
    supabase.from('marketing_periods').select('id').in('status', ['active', 'ready_for_marketing']),
    supabase.from('documents').select('id').is('deleted_at', null),
    supabase.from('candidate_assignments').select('id').eq('user_id', userId).is('ends_on', null),
  ]);

  const counts = new Map<MarketingStatus, number>();
  for (const row of candidates.data ?? []) {
    const status = row.marketing_status as MarketingStatus;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return {
    totalCandidates: candidates.data?.length ?? 0,
    byStatus: [...counts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    activePeriods: periods.data?.length ?? 0,
    documentCount: documents.data?.length ?? 0,
    myActiveAssignments: assignments.data?.length ?? 0,
  };
}
