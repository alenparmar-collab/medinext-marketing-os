import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/**
 * Refreshes the auth session on every request and returns the user.
 *
 * Middleware is a REDIRECT layer, not an authorization layer. It exists so an
 * unauthenticated visitor lands on the sign-in page instead of an error, and so
 * a portal user is not shown an internal shell. Actual access control is RLS
 * plus the server-side permission checks — this could be removed entirely
 * without making the system insecure, only less pleasant.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() revalidates against the auth server. getSession() only reads the
  // cookie, which a client could have tampered with.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}
