import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ActivityType, SourceKind, DocumentVisibility } from '@/config/statuses';

export interface ActivityItem {
  id: string;
  activityType: ActivityType;
  activityDate: string;
  summary: string | null;
  note: string | null;
  companyName: string | null;
  applicationId: string | null;
  sourceType: SourceKind;
  isVerified: boolean;
  visibility: DocumentVisibility;
  createdByName: string | null;
}

const ACTIVITY_COLUMNS =
  'id, activity_type, activity_date, summary, details, application_id, source_type, is_verified, visibility, created_by';

export async function listCandidateActivities(
  candidateId: string,
  limit = 100,
): Promise<ActivityItem[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('marketing_activities')
    .select(ACTIVITY_COLUMNS)
    .eq('candidate_id', candidateId)
    .order('activity_date', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))] as string[];

  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, full_name').in('id', actorIds);
    for (const u of users ?? []) names.set(u.id, u.full_name);
  }

  return rows.map((r) => {
    const details = (r.details ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      activityType: r.activity_type as ActivityType,
      activityDate: r.activity_date,
      summary: r.summary,
      note: typeof details.note === 'string' ? details.note : null,
      companyName: typeof details.company_name === 'string' ? details.company_name : null,
      applicationId: r.application_id,
      sourceType: r.source_type as SourceKind,
      isVerified: r.is_verified,
      visibility: r.visibility as DocumentVisibility,
      createdByName: r.created_by ? (names.get(r.created_by) ?? null) : null,
    };
  });
}

export async function listApplicationActivities(applicationId: string): Promise<ActivityItem[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('marketing_activities')
    .select(ACTIVITY_COLUMNS)
    .eq('application_id', applicationId)
    .order('activity_date', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((r) => {
    const details = (r.details ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      activityType: r.activity_type as ActivityType,
      activityDate: r.activity_date,
      summary: r.summary,
      note: typeof details.note === 'string' ? details.note : null,
      companyName: typeof details.company_name === 'string' ? details.company_name : null,
      applicationId: r.application_id,
      sourceType: r.source_type as SourceKind,
      isVerified: r.is_verified,
      visibility: r.visibility as DocumentVisibility,
      createdByName: null,
    };
  });
}
