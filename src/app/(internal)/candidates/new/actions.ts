'use server';

import { mutation } from '@/server/auth/mutation';
import { CandidateCreateSchema } from '@/server/modules/candidates/schemas';
import { createCandidate } from '@/server/modules/candidates/commands';

/**
 * Actions are thin: validate, delegate, revalidate. The business logic lives in
 * commands.ts, and the permission check happens inside the pipeline before the
 * handler ever runs.
 */
export const createCandidateAction = mutation({
  name: 'candidate.create',
  permission: 'candidate.create',
  schema: CandidateCreateSchema,
  handler: (input, ctx) => createCandidate(input, ctx),
  revalidate: () => ['/candidates', '/overview'],
});
