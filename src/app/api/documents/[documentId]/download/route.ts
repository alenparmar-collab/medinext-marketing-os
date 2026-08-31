import { NextResponse } from 'next/server';
import { requireActor } from '@/server/auth/actor';
import { createDownloadUrl } from '@/server/modules/documents';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Document download.
 *
 * The bytes are NOT proxied through this handler. It verifies, mints a
 * 60-second signed URL and redirects. Proxying would put candidate résumés and
 * identity documents through the function's memory and logs for no benefit.
 *
 * Authorization is the database's: the metadata read and the signing call both
 * run under the caller's own session, so RLS and the storage policy each get a
 * say. This handler adds an audit record and nothing else.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;

  try {
    const actor = await requireActor();
    const { url } = await createDownloadUrl(documentId);

    // Résumés and identity documents leaving the system is exactly what an
    // audit trail is for.
    const supabase = await createServerSupabase();
    await supabase.rpc('record_audit_event', {
      p_action: 'document_download',
      p_entity_type: 'documents',
      p_entity_id: documentId,
      p_metadata: { actor_id: actor.userId },
    });

    return NextResponse.redirect(url, {
      status: 303,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    // NOT_FOUND and FORBIDDEN are answered identically: distinguishing them
    // would confirm that a document exists.
    const status = error instanceof AppError && error.code === 'UNAUTHENTICATED' ? 401 : 404;
    return NextResponse.json(
      { error: 'That document is not available.' },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
