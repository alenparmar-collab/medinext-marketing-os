import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * POST-only: a GET sign-out can be triggered by a prefetch or an image tag,
 * which logs people out unexpectedly.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL('/sign-in', request.url), {
    status: 303,
    headers: { 'Cache-Control': 'no-store' },
  });
}
