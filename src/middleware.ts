import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

const PUBLIC_PATHS = ['/sign-in', '/auth', '/api/health'];

/**
 * Session refresh plus a coarse route guard.
 *
 * This is a REDIRECT layer, not an authorization layer. It knows only whether
 * someone is signed in, never what they may do — that lives in RLS and the
 * server-side permission checks. Splitting internal from portal users happens
 * in each shell's layout, where the actor's roles are actually resolved.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const { response, user } = await updateSession(request);

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    // Preserve where they were going so sign-in can return them there.
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Keeping those out
     * avoids running an auth round trip for every icon.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
