'use server';

import { z } from 'zod';
import { mutation } from '@/server/auth/mutation';
import { uuid, optionalText } from '@/lib/validation/primitives';
import {
  approveProposal,
  evaluateIntelligenceRun,
  resolveProposal,
} from '@/server/modules/decisions/pipeline';

/**
 * Four actions, and the permissions differ on purpose.
 *
 * Rejecting or ignoring needs only `proposal.review` — refusing to create a
 * record is not creating one. Approving needs `proposal.approve` AND, checked
 * inside the CRM command it calls, the permission for the record itself.
 */
const proposalPaths = () => ['/proposals', '/intelligence', '/overview'];

export const evaluateProposalAction = mutation({
  name: 'proposal.evaluate',
  permission: 'intelligence.run',
  schema: z.object({ intelligenceRunId: uuid }),
  handler: (input, ctx) => evaluateIntelligenceRun(input.intelligenceRunId, ctx),
  revalidate: proposalPaths,
});

/**
 * Corrections are a free-form map because the fields differ by event type.
 * They are validated by the CRM command that consumes them — the same
 * validation a recruiter's form goes through — rather than a second time here
 * in a shape that could drift from it.
 */
export const approveProposalAction = mutation({
  name: 'proposal.approve',
  permission: 'proposal.approve',
  schema: z.object({
    reviewItemId: uuid,
    corrections: z.record(z.string(), z.unknown()).optional(),
    notes: optionalText(2000),
  }),
  handler: (input, ctx) =>
    approveProposal(
      {
        reviewItemId: input.reviewItemId,
        ...(input.corrections ? { corrections: input.corrections } : {}),
        notes: input.notes ?? null,
      },
      ctx,
    ),
  revalidate: proposalPaths,
});

export const resolveProposalAction = mutation({
  name: 'proposal.resolve',
  permission: 'proposal.review',
  schema: z.object({
    reviewItemId: uuid,
    status: z.enum(['rejected', 'ignored', 'in_review', 'open']),
    notes: optionalText(2000),
  }),
  handler: (input, ctx) =>
    resolveProposal(
      { reviewItemId: input.reviewItemId, status: input.status, notes: input.notes ?? null },
      ctx,
    ),
  revalidate: proposalPaths,
});
