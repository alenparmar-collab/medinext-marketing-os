'use server';

import { z } from 'zod';
import { mutation } from '@/server/auth/mutation';
import { uuid } from '@/lib/validation/primitives';
import { interpretEmail } from '@/server/modules/intelligence/commands';

/**
 * One action. Interpreting and reprocessing are the same operation, because
 * reprocessing IS interpreting again — it produces a new run rather than
 * editing the old one, so there is nothing for a second action to do
 * differently.
 */
export const interpretEmailAction = mutation({
  name: 'intelligence.interpret',
  permission: 'intelligence.run',
  schema: z.object({ emailMessageId: uuid }),
  handler: (input, ctx) => interpretEmail(input, ctx),
  revalidate: (input) => ['/intelligence', `/emails/${input.emailMessageId}`],
});
