'use server';

import { mutation } from '@/server/auth/mutation';
import {
  ReviewAssignSchema,
  ReviewCreateSchema,
  ReviewResolveSchema,
  ReviewStatusSchema,
} from '@/server/modules/review/schemas';
import {
  assignReviewItem,
  createReviewItem,
  resolveReviewItem,
  runReviewChecks,
  setReviewItemStatus,
} from '@/server/modules/review';
import { z } from 'zod';

const reviewPaths = () => ['/review', '/overview'];

export const assignReviewItemAction = mutation({
  name: 'review.assign',
  permission: 'review.manage',
  schema: ReviewAssignSchema,
  handler: (input, ctx) => assignReviewItem(input, ctx),
  revalidate: reviewPaths,
});

export const setReviewItemStatusAction = mutation({
  name: 'review.status',
  permission: 'review.manage',
  schema: ReviewStatusSchema,
  handler: (input, ctx) => setReviewItemStatus(input, ctx),
  revalidate: reviewPaths,
});

/**
 * Closing an item is a decision, so it is recorded as one: a resolution and a
 * mandatory note. Nothing is deleted — a dismissed item keeps its history.
 */
export const resolveReviewItemAction = mutation({
  name: 'review.resolve',
  permission: 'review.manage',
  schema: ReviewResolveSchema,
  handler: (input, ctx) => resolveReviewItem(input, ctx),
  revalidate: reviewPaths,
});

export const createReviewItemAction = mutation({
  name: 'review.create',
  permission: 'review.manage',
  schema: ReviewCreateSchema,
  handler: (input, ctx) => createReviewItem(input, ctx),
  revalidate: reviewPaths,
});

/**
 * Re-runs the consistency checks for the caller's business unit.
 *
 * Safe to run repeatedly: each finding carries a dedupe key that is unique per
 * unit, so a second run updates the existing item rather than filling the
 * queue with copies.
 */
export const runReviewChecksAction = mutation({
  name: 'review.run_checks',
  permission: 'review.manage',
  schema: z.object({}),
  handler: () => runReviewChecks(),
  revalidate: reviewPaths,
});
