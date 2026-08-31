import 'server-only';
import { randomUUID } from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type {
  ReviewItemPriority,
  ReviewItemStatus,
  ReviewItemType,
  ReviewResolution,
  SourceKind,
} from '@/config/statuses';
import type {
  ReviewAssignInput,
  ReviewCreateInput,
  ReviewListParams,
  ReviewResolveInput,
  ReviewStatusInput,
} from './schemas';

export interface ReviewItem {
  id: string;
  itemType: ReviewItemType;
  priority: ReviewItemPriority;
  status: ReviewItemStatus;
  candidateId: string | null;
  candidateName: string | null;
  applicationId: string | null;
  interviewId: string | null;
  assessmentId: string | null;
  reason: string;
  detail: string | null;
  sourceType: SourceKind;
  assignedTo: string | null;
  assignedToName: string | null;
  resolution: ReviewResolution | null;
  resolutionNotes: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

const COLUMNS =
  'id, item_type, priority, status, candidate_id, application_id, interview_id, assessment_id, reason, detail, source_type, assigned_to, resolution, resolution_notes, resolved_by, resolved_at, created_at';

type Row = {
  id: string;
  item_type: string;
  priority: string;
  status: string;
  candidate_id: string | null;
  application_id: string | null;
  interview_id: string | null;
  assessment_id: string | null;
  reason: string;
  detail: string | null;
  source_type: string;
  assigned_to: string | null;
  resolution: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

async function decorate(rows: Row[]): Promise<ReviewItem[]> {
  if (rows.length === 0) return [];
  const supabase = await createServerSupabase();

  const candidateIds = [...new Set(rows.map((r) => r.candidate_id).filter(Boolean))] as string[];
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.assigned_to, r.resolved_by]).filter(Boolean)),
  ] as string[];

  const [candidates, users] = await Promise.all([
    candidateIds.length > 0
      ? supabase.from('candidates').select('id, full_name').in('id', candidateIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    userIds.length > 0
      ? supabase.from('users').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const candidateNames = new Map((candidates.data ?? []).map((c) => [c.id, c.full_name] as const));
  const userNames = new Map((users.data ?? []).map((u) => [u.id, u.full_name] as const));

  return rows.map((r) => ({
    id: r.id,
    itemType: r.item_type as ReviewItemType,
    priority: r.priority as ReviewItemPriority,
    status: r.status as ReviewItemStatus,
    candidateId: r.candidate_id,
    candidateName: r.candidate_id ? (candidateNames.get(r.candidate_id) ?? null) : null,
    applicationId: r.application_id,
    interviewId: r.interview_id,
    assessmentId: r.assessment_id,
    reason: r.reason,
    detail: r.detail,
    sourceType: r.source_type as SourceKind,
    assignedTo: r.assigned_to,
    assignedToName: r.assigned_to ? (userNames.get(r.assigned_to) ?? null) : null,
    resolution: r.resolution as ReviewResolution | null,
    resolutionNotes: r.resolution_notes,
    resolvedByName: r.resolved_by ? (userNames.get(r.resolved_by) ?? null) : null,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }));
}

export async function listReviewItems(params: ReviewListParams): Promise<ReviewItem[]> {
  const supabase = await createServerSupabase();

  let query = supabase.from('review_items').select(COLUMNS);
  if (params.status) query = query.eq('status', params.status);
  if (params.itemType) query = query.eq('item_type', params.itemType);
  if (params.assignedTo) query = query.eq('assigned_to', params.assignedTo);

  const { data, error } = await query
    // High priority first, then oldest — the queue is worked from the top.
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(params.limit);

  if (error) throw error;
  return decorate((data ?? []) as Row[]);
}

export async function getReviewItem(reviewItemId: string): Promise<ReviewItem> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('review_items')
    .select(COLUMNS)
    .eq('id', reviewItemId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Review item not found.');

  const [item] = await decorate([data as Row]);
  if (!item) throw new AppError('NOT_FOUND', 'Review item not found.');
  return item;
}

export async function countOpenReviewItems(): Promise<number> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('review_items')
    .select('id')
    .in('status', ['open', 'in_review']);
  if (error) throw error;
  return data?.length ?? 0;
}

export async function assignReviewItem(
  input: ReviewAssignInput,
  _actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('review_items')
    .update({ assigned_to: input.assignedTo })
    .eq('id', input.reviewItemId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Review item not found or not permitted.');
  return { id: data.id };
}

export async function setReviewItemStatus(
  input: ReviewStatusInput,
  _actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  // Reopening clears the resolution, because the check constraint requires an
  // open item to carry none.
  const { data, error } = await supabase
    .from('review_items')
    .update({
      status: input.status,
      resolution: null,
      resolution_notes: null,
      resolved_by: null,
      resolved_at: null,
    })
    .eq('id', input.reviewItemId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Review item not found or not permitted.');
  return { id: data.id };
}

/**
 * Closes an item. The row is never deleted — dismissing is a status, and the
 * resolution and note stay with it permanently.
 */
export async function resolveReviewItem(
  input: ReviewResolveInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('review_items')
    .update({
      status: input.status,
      resolution: input.resolution,
      resolution_notes: input.resolutionNotes,
      resolved_by: actor.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', input.reviewItemId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Review item not found or not permitted.');
  return { id: data.id };
}

export async function createReviewItem(
  input: ReviewCreateInput,
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  if (!actor.businessUnitId) {
    throw new AppError('PRECONDITION_FAILED', 'Your account is not attached to a business unit.');
  }

  const { data, error } = await supabase
    .from('review_items')
    .insert({
      business_unit_id: actor.businessUnitId,
      item_type: input.itemType,
      priority: input.priority,
      candidate_id: input.candidateId ?? null,
      reason: input.reason,
      detail: input.detail ?? null,
      source_type: 'manual',
      // Manual items get a unique key so they never collide with a generated
      // finding, and so raising the same concern twice is possible on purpose.
      dedupe_key: `manual:${randomUUID()}`,
    })
    .select('id')
    .single();

  if (error) throw error;
  if (!data) throw new AppError('INTERNAL', 'The review item was not created.');
  return { id: data.id };
}

/** Runs the consistency checks for the caller's business unit. */
export async function runReviewChecks(): Promise<{ openCount: number }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc('request_review_checks');
  if (error) throw error;
  return { openCount: Number(data ?? 0) };
}
