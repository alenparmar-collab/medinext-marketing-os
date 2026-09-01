'use server';

import { z } from 'zod';
import { mutation } from '@/server/auth/mutation';
import { uuid } from '@/lib/validation/primitives';
import { disconnectMailbox, runMailboxSync } from '@/server/modules/email/commands';

/**
 * Two actions, both gated on `mailbox.manage` — which managers do not hold.
 * Connecting is not here: it is an OAuth redirect, not a form submission.
 */
const mailboxPaths = () => ['/settings/mailbox', '/emails'];

export const syncMailboxAction = mutation({
  name: 'mailbox.sync',
  permission: 'mailbox.manage',
  schema: z.object({ mailboxId: uuid }),
  handler: async (input, ctx) => {
    const result = await runMailboxSync(input.mailboxId, ctx, 'manual');
    // The full result carries no content, only counts and a redacted reason,
    // so it is safe to hand back to the browser.
    return result;
  },
  revalidate: mailboxPaths,
});

export const disconnectMailboxAction = mutation({
  name: 'mailbox.disconnect',
  permission: 'mailbox.manage',
  schema: z.object({ mailboxId: uuid }),
  handler: (input, ctx) => disconnectMailbox(input.mailboxId, ctx),
  revalidate: mailboxPaths,
});
