import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * Browser client. Used only for sign-in/sign-out and, in later builds, realtime
 * subscriptions. Page data is fetched on the server, so this client should
 * never accumulate query code.
 */
export function createBrowserSupabase() {
  const env = publicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
