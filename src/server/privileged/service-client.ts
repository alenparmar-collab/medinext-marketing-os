import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serviceRoleKey } from '@/lib/env';
import { createServerSupabase } from '@/lib/supabase/server';
import type { Database } from '@/types/database';
import type { ActorContext } from '@/server/auth/actor';

/**
 * SERVICE ROLE ACCESS — BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * `withServiceRole` is the only export. It takes a mandatory human-readable
 * reason and writes an audit row before running the callback, so an RLS bypass
 * is never silent.
 *
 * There are exactly two legitimate uses in Build 2:
 *   1. Creating an auth user when inviting a candidate to the portal.
 *   2. The seed/import tooling.
 *
 * Anything else is a design smell. If you find yourself reaching for this to
 * make a query work, the RLS policy is probably wrong instead.
 */
type ServiceClient = ReturnType<typeof createClient<Database>>;

function createServiceClient(): ServiceClient {
  const env = publicEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function withServiceRole<T>(
  actor: ActorContext,
  reason: string,
  fn: (db: ServiceClient) => Promise<T>,
): Promise<T> {
  if (!reason || reason.trim().length < 8) {
    throw new Error('withServiceRole requires a substantive reason for the audit trail.');
  }

  // Audited as the acting user, through their own RLS-scoped client, so the
  // record cannot be forged by the privileged path itself.
  const asUser = await createServerSupabase();
  await asUser.rpc('record_audit_event', {
    p_action: 'service_role_use',
    p_entity_type: 'system',
    p_entity_id: null,
    p_metadata: { reason, actor_id: actor.userId },
  });

  return fn(createServiceClient());
}
