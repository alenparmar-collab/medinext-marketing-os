import 'server-only';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Reference lookups used to populate forms. All RLS-filtered, so a user only
 * ever sees units and colleagues within their own reach.
 */
export interface BusinessUnitOption {
  id: string;
  code: string;
  name: string;
}

export interface UserOption {
  id: string;
  fullName: string;
  email: string;
}

export interface DocumentTypeOption {
  code: string;
  label: string;
  candidateVisibleDefault: boolean;
}

export async function listBusinessUnits(): Promise<BusinessUnitOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('business_units')
    .select('id, code, name')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((u) => ({ id: u.id, code: u.code, name: u.name }));
}

export async function listAssignableUsers(): Promise<UserOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, email, status')
    .eq('status', 'active')
    .order('full_name');
  if (error) throw error;

  // Candidates hold no internal roles, so they must never appear as assignees.
  const ids = (data ?? []).map((u) => u.id);
  if (ids.length === 0) return [];

  const { data: roles } = await supabase
    .from('user_roles')
    .select('user_id, role_code')
    .in('user_id', ids)
    .in('role_code', ['admin', 'manager', 'recruiter']);

  const internal = new Set((roles ?? []).map((r) => r.user_id));

  return (data ?? [])
    .filter((u) => internal.has(u.id))
    .map((u) => ({ id: u.id, fullName: u.full_name, email: u.email }));
}

export async function listDocumentTypes(): Promise<DocumentTypeOption[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('document_types')
    .select('code, label, candidate_visible_default, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map((t) => ({
    code: t.code,
    label: t.label,
    candidateVisibleDefault: t.candidate_visible_default,
  }));
}
