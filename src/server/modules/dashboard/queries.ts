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
  myActiveAssignments: number;
  /** Derived from records, never a stored total. */
  applications: number;
  applicationsLast30Days: number;
  interviews: number;
  openApplications: number;
}

export async function getOverviewMetrics(userId: string): Promise<OverviewMetrics> {
  const supabase = await createServerSupabase();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [candidates, periods, assignments, applications, interviews] = await Promise.all([
    supabase.from('candidates').select('marketing_status').is('archived_at', null),
    supabase.from('marketing_periods').select('id').in('status', ['active', 'ready_for_marketing']),
    supabase.from('candidate_assignments').select('id').eq('user_id', userId).is('ends_on', null),
    // Every application row the caller may see. RLS decides the scope, so a
    // recruiter's figure covers their book and a manager's the unit.
    supabase.from('applications').select('id, status, application_date'),
    supabase
      .from('marketing_activities')
      .select('id')
      .eq('activity_type', 'interview'),
  ]);

  const applicationRows = applications.data ?? [];
  const terminal = new Set(['rejected', 'withdrawn', 'closed']);

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
    myActiveAssignments: assignments.data?.length ?? 0,
    applications: applicationRows.length,
    applicationsLast30Days: applicationRows.filter((a) => a.application_date >= thirtyDaysAgo)
      .length,
    openApplications: applicationRows.filter((a) => !terminal.has(a.status)).length,
    interviews: interviews.data?.length ?? 0,
  };
}
