import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { DailyReportStatus } from '@/config/statuses';
import type { DailyReportListParams } from './schemas';

/**
 * SYSTEM-CALCULATED figures. Nothing stores these; they are counted from the
 * records every time, by the single definition in public.daily_report_metrics.
 */
export interface ReportMetrics {
  applications: number;
  recruiterResponses: number;
  interviews: number;
  assessments: number;
  rejections: number;
}

export const ZERO_METRICS: ReportMetrics = {
  applications: 0,
  recruiterResponses: 0,
  interviews: 0,
  assessments: 0,
  rejections: 0,
};

export interface DailyReportListItem {
  id: string;
  recruiterId: string;
  recruiterName: string;
  reportDate: string;
  status: DailyReportStatus;
  /** Live figures, derived now. */
  live: ReportMetrics;
  /** Frozen at confirmation. Null while the report is a draft. */
  snapshot: ReportMetrics | null;
  confirmedAt: string | null;
  hasNotes: boolean;
}

export interface DailyReportDetail extends DailyReportListItem {
  businessUnitId: string;
  notes: string | null;
  observations: string | null;
  exceptions: string | null;
  confirmedByName: string | null;
  snapshotTakenAt: string | null;
  /**
   * True when the frozen figures no longer match what the records say — a
   * record was added or changed after confirmation. Surfaced rather than
   * hidden: it is exactly the kind of discrepancy a reconciliation exists to
   * reveal, and neither number is wrong.
   */
  snapshotDiffers: boolean;
}

const COLUMNS =
  'id, business_unit_id, recruiter_id, report_date, status, notes, observations, exceptions, snapshot_applications, snapshot_recruiter_responses, snapshot_interviews, snapshot_assessments, snapshot_rejections, snapshot_taken_at, confirmed_by, confirmed_at';

type ReportRow = {
  id: string;
  business_unit_id: string;
  recruiter_id: string;
  report_date: string;
  status: string;
  notes: string | null;
  observations: string | null;
  exceptions: string | null;
  snapshot_applications: number | null;
  snapshot_recruiter_responses: number | null;
  snapshot_interviews: number | null;
  snapshot_assessments: number | null;
  snapshot_rejections: number | null;
  snapshot_taken_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
};

function snapshotOf(row: ReportRow): ReportMetrics | null {
  if (row.snapshot_taken_at === null) return null;
  return {
    applications: row.snapshot_applications ?? 0,
    recruiterResponses: row.snapshot_recruiter_responses ?? 0,
    interviews: row.snapshot_interviews ?? 0,
    assessments: row.snapshot_assessments ?? 0,
    rejections: row.snapshot_rejections ?? 0,
  };
}

/** The live derivation for one person on one day. */
export async function getReportMetrics(
  recruiterId: string,
  reportDate: string,
): Promise<ReportMetrics> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase.rpc('daily_report_metrics', {
    p_recruiter_id: recruiterId,
    p_report_date: reportDate,
  });

  if (error) throw error;

  const row = data?.[0];
  if (!row) return ZERO_METRICS;

  return {
    applications: Number(row.applications),
    recruiterResponses: Number(row.recruiter_responses),
    interviews: Number(row.interviews),
    assessments: Number(row.assessments),
    rejections: Number(row.rejections),
  };
}

export async function listDailyReports(
  params: DailyReportListParams,
): Promise<DailyReportListItem[]> {
  const supabase = await createServerSupabase();

  let query = supabase.from('daily_reports').select(COLUMNS);

  if (params.recruiterId) query = query.eq('recruiter_id', params.recruiterId);
  if (params.from) query = query.gte('report_date', params.from);
  if (params.to) query = query.lte('report_date', params.to);

  const { data, error } = await query
    .order('report_date', { ascending: false })
    .order('recruiter_id', { ascending: true })
    .limit(params.limit);

  if (error) throw error;

  const rows = (data ?? []) as ReportRow[];
  if (rows.length === 0) return [];

  const { data: users } = await supabase
    .from('users')
    .select('id, full_name')
    .in('id', [...new Set(rows.map((r) => r.recruiter_id))]);
  const names = new Map((users ?? []).map((u) => [u.id, u.full_name] as const));

  // Each row's live figures come from the same function the snapshot used, so a
  // draft and a confirmed report are directly comparable.
  const live = await Promise.all(
    rows.map((r) => getReportMetrics(r.recruiter_id, r.report_date)),
  );

  return rows.map((r, i) => ({
    id: r.id,
    recruiterId: r.recruiter_id,
    recruiterName: names.get(r.recruiter_id) ?? 'Unknown user',
    reportDate: r.report_date,
    status: r.status as DailyReportStatus,
    live: live[i] ?? ZERO_METRICS,
    snapshot: snapshotOf(r),
    confirmedAt: r.confirmed_at,
    hasNotes: Boolean(r.notes || r.observations || r.exceptions),
  }));
}

export async function getDailyReport(reportId: string): Promise<DailyReportDetail> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('daily_reports')
    .select(COLUMNS)
    .eq('id', reportId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Report not found.');

  const row = data as ReportRow;
  const [live, users] = await Promise.all([
    getReportMetrics(row.recruiter_id, row.report_date),
    supabase
      .from('users')
      .select('id, full_name')
      .in('id', [row.recruiter_id, row.confirmed_by].filter(Boolean) as string[]),
  ]);

  const names = new Map((users.data ?? []).map((u) => [u.id, u.full_name] as const));
  const snapshot = snapshotOf(row);

  return {
    id: row.id,
    businessUnitId: row.business_unit_id,
    recruiterId: row.recruiter_id,
    recruiterName: names.get(row.recruiter_id) ?? 'Unknown user',
    reportDate: row.report_date,
    status: row.status as DailyReportStatus,
    live,
    snapshot,
    notes: row.notes,
    observations: row.observations,
    exceptions: row.exceptions,
    confirmedAt: row.confirmed_at,
    confirmedByName: row.confirmed_by ? (names.get(row.confirmed_by) ?? null) : null,
    snapshotTakenAt: row.snapshot_taken_at,
    hasNotes: Boolean(row.notes || row.observations || row.exceptions),
    snapshotDiffers:
      snapshot !== null &&
      (snapshot.applications !== live.applications ||
        snapshot.recruiterResponses !== live.recruiterResponses ||
        snapshot.interviews !== live.interviews ||
        snapshot.assessments !== live.assessments ||
        snapshot.rejections !== live.rejections),
  };
}

/** The signed-in user's report for a date, if one exists yet. */
export async function findOwnReport(
  recruiterId: string,
  reportDate: string,
): Promise<{ id: string; status: DailyReportStatus } | null> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('daily_reports')
    .select('id, status')
    .eq('recruiter_id', recruiterId)
    .eq('report_date', reportDate)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return { id: data.id, status: data.status as DailyReportStatus };
}

export interface TeamDayRow {
  recruiterId: string;
  recruiterName: string;
  /** Counted from that person's records for the date. */
  live: ReportMetrics;
  reportId: string | null;
  status: DailyReportStatus | null;
  confirmedAt: string | null;
  hasNotes: boolean;
}

export interface TeamDayOverview {
  reportDate: string;
  rows: TeamDayRow[];
  totals: ReportMetrics;
  confirmedCount: number;
  draftCount: number;
  missingCount: number;
}

/**
 * The manager's view of one day.
 *
 * The figures are counted per person from their own records and then added up.
 * The unit total is therefore the sum of real records, not a separately stored
 * number that could drift from them — and there is no input anywhere on this
 * path that would let somebody type one.
 *
 * One metrics call per person. That is N small indexed queries rather than one
 * clever join, and N is the size of a business unit's recruiting team.
 */
export async function getTeamDayOverview(
  people: { id: string; fullName: string }[],
  reportDate: string,
): Promise<TeamDayOverview> {
  const supabase = await createServerSupabase();

  const { data: reportRows, error } = await supabase
    .from('daily_reports')
    .select('id, recruiter_id, status, confirmed_at, notes, observations, exceptions')
    .eq('report_date', reportDate);

  if (error) throw error;

  const byRecruiter = new Map((reportRows ?? []).map((r) => [r.recruiter_id, r] as const));

  const metrics = await Promise.all(people.map((p) => getReportMetrics(p.id, reportDate)));

  const rows: TeamDayRow[] = people.map((person, i) => {
    const report = byRecruiter.get(person.id);
    return {
      recruiterId: person.id,
      recruiterName: person.fullName,
      live: metrics[i] ?? ZERO_METRICS,
      reportId: report?.id ?? null,
      status: (report?.status as DailyReportStatus | undefined) ?? null,
      confirmedAt: report?.confirmed_at ?? null,
      hasNotes: Boolean(report?.notes || report?.observations || report?.exceptions),
    };
  });

  const totals = rows.reduce<ReportMetrics>(
    (acc, row) => ({
      applications: acc.applications + row.live.applications,
      recruiterResponses: acc.recruiterResponses + row.live.recruiterResponses,
      interviews: acc.interviews + row.live.interviews,
      assessments: acc.assessments + row.live.assessments,
      rejections: acc.rejections + row.live.rejections,
    }),
    { ...ZERO_METRICS },
  );

  return {
    reportDate,
    rows,
    totals,
    confirmedCount: rows.filter((r) => r.status === 'confirmed').length,
    draftCount: rows.filter((r) => r.status === 'draft').length,
    missingCount: rows.filter((r) => r.status === null).length,
  };
}
