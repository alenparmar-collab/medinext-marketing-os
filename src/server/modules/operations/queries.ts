import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * The operational day, counted from records.
 *
 * The rule this module exists to hold: A NUMBER HERE IS A COUNT OF ROWS THAT
 * EXIST. Not of emails that arrived, not of readings a model produced, not of
 * proposals that were made. An application counts when there is an application;
 * an interview counts when there is an interview. A proposal still in review is
 * not an interview, and an email that produced three readings is not three of
 * anything.
 *
 * That distinction is the difference between a report a recruiter can defend in
 * a meeting and one that inflates itself every time the mailbox is busy — so
 * every figure below carries the ids of the rows it counted, and the report can
 * show them.
 *
 * Everything runs through the caller's RLS-scoped client, so "the day" is
 * always the day in the tenants and units that caller may see.
 */

export interface TracedRecord {
  id: string;
  label: string;
  candidateName: string | null;
  /** manual · email · system — the existing source vocabulary, not a new one. */
  source: string;
  /** Whether a person confirmed it. An automatic write is not verified. */
  verified: boolean;
  href: string;
}

export interface CountedBucket {
  count: number;
  records: TracedRecord[];
}

export interface OperationsSummary {
  date: string;
  /** CRM records that exist, by kind. */
  applications: CountedBucket;
  interviews: CountedBucket;
  assessments: CountedBucket;
  rejections: CountedBucket;

  /** Decision activity. Proposals, not records — never added to the figures above. */
  needsReview: number;
  autoApproved: number;
  humanApproved: number;
  ignored: number;
  rejectedProposals: number;
  partialFailures: number;
  interpretationChanges: number;
  highPriorityOpen: number;

  /** Pipeline volume, reported separately and never as CRM activity. */
  emailsReceived: number;
  interpretations: number;

  /** Of the CRM records above, how many came from email rather than a person. */
  fromEmail: number;
  fromPerson: number;
}

/** Local day bounds. Dates are handled as UTC days, as everywhere else here. */
function dayBounds(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function sourceLabel(sourceType: string | null): string {
  if (sourceType === 'email_event') return 'email';
  if (sourceType === 'system' || sourceType === 'api') return 'system';
  return 'manual';
}

/**
 * One day, in one pass per table.
 *
 * Six table reads, not one per figure and never one per row: the counts and the
 * traceable record lists come from the same rows, so asking twice would be both
 * slower and a chance for the number and the list to disagree.
 */
export async function getOperationsSummary(date: string): Promise<OperationsSummary> {
  const supabase = await createServerSupabase();
  const { start, end } = dayBounds(date);

  const [applications, interviews, assessments, rejections, decisions, emails, runs] =
    await Promise.all([
      supabase
        .from('applications')
        .select('id, candidate_id, company_name, position_title, source_type, verified_at')
        .gte('created_at', start)
        .lt('created_at', end),
      supabase
        .from('interviews')
        .select('id, candidate_id, application_id, scheduled_at, source_type, verified_at')
        .gte('created_at', start)
        .lt('created_at', end),
      supabase
        .from('assessments')
        .select('id, candidate_id, assessment_type, source_type, verified_at')
        .gte('created_at', start)
        .lt('created_at', end),
      // A rejection changes an application rather than creating a row, so it is
      // counted from the status history — the same record the timeline reads.
      supabase
        .from('application_status_history')
        .select('id, application_id, to_status, source_type, changed_at')
        .eq('to_status', 'rejected')
        .gte('changed_at', start)
        .lt('changed_at', end),
      supabase
        .from('intelligence_review_items')
        .select('id, status, outcome, priority, reviewed_by, failure_code, supersedes_item_id, created_at')
        .gte('created_at', start)
        .lt('created_at', end),
      supabase
        .from('email_messages')
        .select('id')
        .gte('received_at', start)
        .lt('received_at', end),
      supabase
        .from('email_intelligence_runs')
        .select('id')
        .gte('created_at', start)
        .lt('created_at', end),
    ]);

  for (const result of [applications, interviews, assessments, rejections, decisions, emails, runs]) {
    if (result.error) throw result.error;
  }

  const applicationRows = applications.data ?? [];
  const interviewRows = interviews.data ?? [];
  const assessmentRows = assessments.data ?? [];
  const rejectionRows = rejections.data ?? [];
  const decisionRows = decisions.data ?? [];

  // One lookup for every candidate named across all four buckets, rather than
  // one per record.
  const candidateIds = [
    ...new Set(
      [...applicationRows, ...interviewRows, ...assessmentRows]
        .map((r) => r.candidate_id)
        .filter(Boolean),
    ),
  ] as string[];

  const { data: candidateRows } = candidateIds.length
    ? await supabase.from('candidates').select('id, full_name').in('id', candidateIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((candidateRows ?? []).map((c) => [c.id, c.full_name] as const));

  const applicationBucket: CountedBucket = {
    count: applicationRows.length,
    records: applicationRows.map((row) => ({
      id: row.id,
      label: `${row.company_name} — ${row.position_title}`,
      candidateName: nameById.get(row.candidate_id) ?? null,
      source: sourceLabel(row.source_type),
      verified: row.verified_at !== null,
      href: `/applications/${row.id}`,
    })),
  };

  const interviewBucket: CountedBucket = {
    count: interviewRows.length,
    records: interviewRows.map((row) => ({
      id: row.id,
      label: row.scheduled_at ? `Interview — ${row.scheduled_at.slice(0, 16).replace('T', ' ')}` : 'Interview',
      candidateName: nameById.get(row.candidate_id) ?? null,
      source: sourceLabel(row.source_type),
      verified: row.verified_at !== null,
      href: `/interviews/${row.id}`,
    })),
  };

  const assessmentBucket: CountedBucket = {
    count: assessmentRows.length,
    records: assessmentRows.map((row) => ({
      id: row.id,
      label: row.assessment_type ?? 'Assessment',
      candidateName: nameById.get(row.candidate_id) ?? null,
      source: sourceLabel(row.source_type),
      verified: row.verified_at !== null,
      href: `/assessments/${row.id}`,
    })),
  };

  const rejectionBucket: CountedBucket = {
    count: rejectionRows.length,
    records: rejectionRows.map((row) => ({
      id: row.id,
      label: 'Application rejected',
      candidateName: null,
      source: sourceLabel(row.source_type),
      verified: true,
      href: `/applications/${row.application_id}`,
    })),
  };

  const crmRecords = [
    ...applicationBucket.records,
    ...interviewBucket.records,
    ...assessmentBucket.records,
  ];

  return {
    date,
    applications: applicationBucket,
    interviews: interviewBucket,
    assessments: assessmentBucket,
    rejections: rejectionBucket,

    needsReview: decisionRows.filter((r) => r.status === 'open' || r.status === 'in_review').length,
    // Auto-approved and human-approved are counted apart: "how much did the
    // machine do on its own" is the question this exists to answer.
    autoApproved: decisionRows.filter(
      (r) => r.status === 'approved' && r.outcome === 'auto_approve' && r.reviewed_by === null,
    ).length,
    humanApproved: decisionRows.filter((r) => r.status === 'approved' && r.reviewed_by !== null)
      .length,
    ignored: decisionRows.filter((r) => r.status === 'ignored').length,
    rejectedProposals: decisionRows.filter((r) => r.status === 'rejected').length,
    partialFailures: decisionRows.filter((r) => r.failure_code === 'partial_failure').length,
    interpretationChanges: decisionRows.filter((r) => r.supersedes_item_id !== null).length,
    highPriorityOpen: decisionRows.filter(
      (r) => r.priority === 'high' && (r.status === 'open' || r.status === 'in_review'),
    ).length,

    emailsReceived: (emails.data ?? []).length,
    interpretations: (runs.data ?? []).length,

    fromEmail: crmRecords.filter((r) => r.source === 'email').length,
    fromPerson: crmRecords.filter((r) => r.source !== 'email').length,
  };
}

/**
 * The queue as it stands right now, for the dashboard.
 *
 * Deliberately separate from the daily summary: "what happened today" and
 * "what is waiting" are different questions, and a queue item raised last week
 * is still waiting today.
 */
export interface QueueStanding {
  waiting: number;
  highPriority: number;
  interpretationChanges: number;
  partialFailures: number;
}

export async function getQueueStanding(): Promise<QueueStanding> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('intelligence_review_items')
    .select('status, priority, supersedes_item_id, failure_code');

  if (error) throw error;
  const rows = data ?? [];
  const open = rows.filter((r) => r.status === 'open' || r.status === 'in_review');

  return {
    waiting: open.length,
    highPriority: open.filter((r) => r.priority === 'high').length,
    interpretationChanges: open.filter((r) => r.supersedes_item_id !== null).length,
    partialFailures: rows.filter((r) => r.failure_code === 'partial_failure').length,
  };
}
