import { z } from 'zod';
import { uuid, optionalText, requiredText } from '@/lib/validation/primitives';
import {
  REVIEW_ITEM_STATUSES,
  REVIEW_ITEM_TYPES,
  REVIEW_ITEM_PRIORITIES,
  REVIEW_RESOLUTIONS,
} from '@/config/statuses';

export const ReviewListParamsSchema = z.object({
  status: z.enum(REVIEW_ITEM_STATUSES).optional(),
  itemType: z.enum(REVIEW_ITEM_TYPES).optional(),
  assignedTo: uuid.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});

export type ReviewListParams = z.infer<typeof ReviewListParamsSchema>;

export const ReviewAssignSchema = z.object({
  reviewItemId: uuid,
  // Null clears the assignment rather than being a missing field.
  assignedTo: uuid.nullable(),
});

export type ReviewAssignInput = z.infer<typeof ReviewAssignSchema>;

export const ReviewStatusSchema = z.object({
  reviewItemId: uuid,
  status: z.enum(['open', 'in_review'] as const),
});

export type ReviewStatusInput = z.infer<typeof ReviewStatusSchema>;

/**
 * Closing an item requires a resolution and a note.
 *
 * The note is mandatory because the queue's value is the record of what was
 * decided, not the fact that something was clicked. Dismissing without saying
 * why leaves the next person exactly where they started.
 */
export const ReviewResolveSchema = z.object({
  reviewItemId: uuid,
  status: z.enum(['resolved', 'dismissed'] as const),
  resolution: z.enum(REVIEW_RESOLUTIONS),
  resolutionNotes: requiredText('Resolution note', 2000),
});

export type ReviewResolveInput = z.infer<typeof ReviewResolveSchema>;

/** Manual items, for something a person spots that no check covers. */
export const ReviewCreateSchema = z.object({
  candidateId: uuid.optional(),
  itemType: z.enum(REVIEW_ITEM_TYPES),
  priority: z.enum(REVIEW_ITEM_PRIORITIES).default('normal'),
  reason: requiredText('Reason', 300),
  detail: optionalText(2000),
});

export type ReviewCreateInput = z.infer<typeof ReviewCreateSchema>;
