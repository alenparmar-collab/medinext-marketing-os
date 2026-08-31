import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type {
  MarketingStatus,
  ApplicationStatus,
  ActivityType,
  InterviewStatus,
  AssessmentStatus,
} from '@/config/statuses';
import { UPCOMING_INTERVIEW_STATUSES } from '@/config/statuses';

/**
 * PORTAL DATA ACCESS — the only module a portal route may import.
 *
 * Isolation here rests on four independent layers (docs/architecture/08 §2):
 *   1. Route group + middleware guard
 *   2. This module boundary, enforced by ESLint import zones
 *   3. Narrow projections — internal columns are never selected
 *   4. RLS keyed on candidates.user_id = auth.uid()
 *
 * Only the fourth is load-bearing for security. The others exist so a mistake in
 * one is caught by another.
 *
 * Every function scopes by the caller's own candidate id, which comes from the
 * session, never from a URL or form field. There is no function in this file
 * that accepts a candidate id from the caller — that is deliberate.
 */

/**
 * A single string literal, deliberately: Supabase infers the row shape from the
 * literal type, so concatenation would widen it to `string` and collapse the
 * result type.
 *
 * Note what is NOT here: visa_status, internal notes, assignment data, source
 * columns. The narrow projection is one of the portal's isolation layers.
 */
const PROFILE_COLUMNS =
  'reference, full_name, email, phone, primary_skill, skills, total_experience_months, current_location, education, certifications, preferred_locations, marketing_status';

export interface PortalProfile {
  reference: string;
  fullName: string;
  email: string;
  phone: string | null;
  primarySkill: string | null;
  skills: string[];
  experienceMonths: number | null;
  currentLocation: string | null;
  education: string | null;
  certifications: string[];
  preferredLocations: string[];
  marketingStatus: MarketingStatus;
}

export interface PortalMarketingPeriod {
  id: string;
  startsOn: string;
  endsOn: string | null;
  status: MarketingStatus;
}

export interface PortalDocument {
  id: string;
  documentType: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
}

export async function getMyProfile(candidateId: string): Promise<PortalProfile> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('candidates')
    .select(PROFILE_COLUMNS)
    .eq('id', candidateId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Your record is not available.');

  return {
    reference: data.reference,
    fullName: data.full_name,
    email: data.email,
    phone: data.phone,
    primarySkill: data.primary_skill,
    skills: data.skills ?? [],
    experienceMonths: data.total_experience_months,
    currentLocation: data.current_location,
    education: data.education,
    certifications: data.certifications ?? [],
    preferredLocations: data.preferred_locations ?? [],
    marketingStatus: data.marketing_status as MarketingStatus,
  };
}

export async function getMyMarketingPeriods(candidateId: string): Promise<PortalMarketingPeriod[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('marketing_periods')
    .select('id, starts_on, ends_on, status')
    .eq('candidate_id', candidateId)
    .order('starts_on', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((p) => ({
    id: p.id,
    startsOn: p.starts_on,
    endsOn: p.ends_on,
    status: p.status as MarketingStatus,
  }));
}

/**
 * Returns only documents a staff member deliberately published. The
 * `visibility` filter is redundant with the RLS policy — kept because defence
 * in depth costs nothing here and the intent should be readable at the call
 * site as well as in the policy.
 */
export async function getMyDocuments(candidateId: string): Promise<PortalDocument[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('documents')
    .select('id, document_type, file_name, size_bytes, uploaded_at')
    .eq('candidate_id', candidateId)
    .eq('visibility', 'candidate_visible')
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((d) => ({
    id: d.id,
    documentType: d.document_type,
    fileName: d.file_name,
    sizeBytes: d.size_bytes,
    uploadedAt: d.uploaded_at,
  }));
}

/* ===========================================================================
 * BUILD 3 — applications and timeline for the portal
 *
 * Both scope by the caller's own candidate id, which comes from the session and
 * never from a URL or form field. There is no function in this module that
 * accepts a candidate id from the caller.
 *
 * The column projections are narrow on purpose: internal notes, source
 * metadata, verification state and staff identities are simply not selected, so
 * they cannot reach a portal DTO even by accident. RLS is what makes that a
 * guarantee rather than a habit.
 * =========================================================================== */

const PORTAL_APPLICATION_COLUMNS =
  'id, company_name, position_title, job_location, application_date, status';

export interface PortalApplication {
  id: string;
  companyName: string;
  positionTitle: string;
  jobLocation: string | null;
  applicationDate: string;
  status: ApplicationStatus;
}

export async function getMyApplications(candidateId: string): Promise<PortalApplication[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('applications')
    .select(PORTAL_APPLICATION_COLUMNS)
    .eq('candidate_id', candidateId)
    .order('application_date', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((a) => ({
    id: a.id,
    companyName: a.company_name,
    positionTitle: a.position_title,
    jobLocation: a.job_location,
    applicationDate: a.application_date,
    status: a.status as ApplicationStatus,
  }));
}

export interface PortalTimelineEntry {
  id: string;
  activityType: ActivityType;
  activityDate: string;
  summary: string | null;
  companyName: string | null;
}

/**
 * The candidate's own activity.
 *
 * The visibility filter is redundant with the RLS policy — kept because the
 * intent should be readable at the call site as well as in the policy, and
 * because defence in depth costs nothing here.
 */
export async function getMyTimeline(
  candidateId: string,
  limit = 100,
): Promise<PortalTimelineEntry[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('marketing_activities')
    .select('id, activity_type, activity_date, summary, details')
    .eq('candidate_id', candidateId)
    .eq('visibility', 'candidate_visible')
    .order('activity_date', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((r) => {
    const details = (r.details ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      activityType: r.activity_type as ActivityType,
      activityDate: r.activity_date,
      summary: r.summary,
      companyName: typeof details.company_name === 'string' ? details.company_name : null,
    };
  });
}

/** Counts for the portal summary, derived from the candidate's own records. */
export async function getMyCounts(candidateId: string): Promise<{
  applications: number;
  interviews: number;
  assessments: number;
  offers: number;
}> {
  const supabase = await createServerSupabase();

  // Interviews and assessments are counted from their own tables now that they
  // are first-class records; offers remain an activity type.
  const [apps, interviews, assessments, activities] = await Promise.all([
    supabase.from('applications').select('id').eq('candidate_id', candidateId),
    supabase.from('interviews').select('id').eq('candidate_id', candidateId),
    supabase.from('assessments').select('id').eq('candidate_id', candidateId),
    supabase
      .from('marketing_activities')
      .select('activity_type')
      .eq('candidate_id', candidateId)
      .eq('visibility', 'candidate_visible'),
  ]);

  const rows = activities.data ?? [];

  return {
    applications: apps.data?.length ?? 0,
    interviews: interviews.data?.length ?? 0,
    assessments: assessments.data?.length ?? 0,
    offers: rows.filter((r) => r.activity_type === 'offer').length,
  };
}

/* ===========================================================================
 * BUILD 4 — interviews, assessments and notifications for the portal
 *
 * Same rules as everything else in this module: scoped by the candidate id on
 * the session, never from a URL, and projected narrowly.
 *
 * Note what is NOT selected: `notes` on interviews and assessments,
 * interviewer email, source and verification metadata, and the whole schedule
 * history. Internal commentary never enters a portal DTO.
 * =========================================================================== */

const PORTAL_INTERVIEW_COLUMNS =
  'id, application_id, interview_round, scheduled_at, time_zone, meeting_url, status';

export interface PortalInterview {
  id: string;
  companyName: string;
  positionTitle: string;
  interviewRound: number;
  scheduledAt: string | null;
  timeZone: string | null;
  meetingUrl: string | null;
  status: InterviewStatus;
  isUpcoming: boolean;
}

export async function getMyInterviews(candidateId: string): Promise<PortalInterview[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('interviews')
    .select(PORTAL_INTERVIEW_COLUMNS)
    .eq('candidate_id', candidateId)
    .order('scheduled_at', { ascending: false, nullsFirst: false });

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: apps } = await supabase
    .from('applications')
    .select('id, company_name, position_title')
    .in('id', [...new Set(rows.map((r) => r.application_id))]);

  const appById = new Map((apps ?? []).map((a) => [a.id, a] as const));
  const now = Date.now();

  return rows.map((r) => {
    const app = appById.get(r.application_id);
    const status = r.status as InterviewStatus;
    return {
      id: r.id,
      companyName: app?.company_name ?? 'Your recruiter will confirm',
      positionTitle: app?.position_title ?? '',
      interviewRound: r.interview_round,
      scheduledAt: r.scheduled_at,
      timeZone: r.time_zone,
      meetingUrl: r.meeting_url,
      status,
      isUpcoming:
        (UPCOMING_INTERVIEW_STATUSES as readonly string[]).includes(status) &&
        r.scheduled_at !== null &&
        Date.parse(r.scheduled_at) >= now,
    };
  });
}

const PORTAL_ASSESSMENT_COLUMNS =
  'id, application_id, assessment_type, assessment_url, received_at, deadline, completed_at, status, outcome';

export interface PortalAssessment {
  id: string;
  companyName: string;
  positionTitle: string;
  assessmentType: string;
  assessmentUrl: string | null;
  receivedAt: string;
  deadline: string | null;
  completedAt: string | null;
  status: AssessmentStatus;
  outcome: string | null;
  isOpen: boolean;
  isOverdue: boolean;
}

export async function getMyAssessments(candidateId: string): Promise<PortalAssessment[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('assessments')
    .select(PORTAL_ASSESSMENT_COLUMNS)
    .eq('candidate_id', candidateId)
    .order('received_at', { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: apps } = await supabase
    .from('applications')
    .select('id, company_name, position_title')
    .in('id', [...new Set(rows.map((r) => r.application_id))]);

  const appById = new Map((apps ?? []).map((a) => [a.id, a] as const));
  const now = Date.now();

  return rows.map((r) => {
    const app = appById.get(r.application_id);
    const status = r.status as AssessmentStatus;
    const isOpen = status === 'pending' || status === 'in_progress';
    return {
      id: r.id,
      companyName: app?.company_name ?? 'Your recruiter will confirm',
      positionTitle: app?.position_title ?? '',
      assessmentType: r.assessment_type,
      assessmentUrl: r.assessment_url,
      receivedAt: r.received_at,
      deadline: r.deadline,
      completedAt: r.completed_at,
      status,
      outcome: r.outcome,
      isOpen,
      isOverdue: isOpen && r.deadline !== null && Date.parse(r.deadline) < now,
    };
  });
}

/**
 * Document types a candidate may send us.
 *
 * Lives in the portal module rather than being imported from the internal
 * reference module — portal routes may only reach this module, and that
 * boundary is enforced by lint precisely so an internal query never gets
 * reused here by habit.
 */
export interface PortalDocumentType {
  code: string;
  label: string;
}

const CANDIDATE_UPLOADABLE = [
  'resume',
  'cover_letter',
  'certification',
  'education_document',
  'other',
];

export async function getUploadableDocumentTypes(): Promise<PortalDocumentType[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('document_types')
    .select('code, label, is_active, sort_order')
    .eq('is_active', true)
    .in('code', CANDIDATE_UPLOADABLE)
    .order('sort_order');

  if (error) throw error;
  return (data ?? []).map((t) => ({ code: t.code, label: t.label }));
}
