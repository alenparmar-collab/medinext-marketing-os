import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { MarketingStatus } from '@/config/statuses';

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
