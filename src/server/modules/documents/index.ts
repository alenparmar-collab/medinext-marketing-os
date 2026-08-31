import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { createServerSupabase } from '@/lib/supabase/server';
import { AppError } from '@/server/auth/errors';
import type { ActorContext } from '@/server/auth/actor';
import type { DocumentVisibility } from '@/config/statuses';
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from './schemas';

const BUCKET = 'candidate-documents';

export interface DocumentItem {
  id: string;
  candidateId: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: DocumentVisibility;
  version: number;
  uploadedByName: string | null;
  uploadedAt: string;
}

/**
 * Storage key convention, matching what the storage policies parse:
 *     {candidate_id}/{document_type}/{uuid}-{file_name}
 *
 * The first segment is the authorization key. A uuid prefix keeps two uploads
 * of "cv.pdf" from colliding without either overwriting the other.
 */
function storageKey(candidateId: string, documentType: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 160);
  return `${candidateId}/${documentType}/${randomUUID()}-${safeName}`;
}

/**
 * Uploads a file and records its metadata.
 *
 * Both writes go through the USER-SCOPED client, so the storage policy and the
 * table policy each apply to the caller. A recruiter uploading for a candidate
 * they cannot access is refused by the database, not by a check here.
 *
 * Order matters: the object is written first. A stored object with no metadata
 * row is invisible and harmless; a metadata row pointing at a missing object
 * would show the candidate a file that cannot be downloaded.
 */
export async function uploadDocument(
  input: {
    candidateId: string;
    documentType: string;
    fileName: string;
    mimeType: string;
    bytes: ArrayBuffer;
    visibility: DocumentVisibility;
  },
  actor: ActorContext,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const size = input.bytes.byteLength;
  if (size === 0) throw new AppError('VALIDATION', 'The file is empty.');
  if (size > MAX_UPLOAD_BYTES) throw new AppError('VALIDATION', 'Files must be 25 MB or smaller.');
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new AppError('VALIDATION', 'That file type is not accepted.');
  }

  // The candidate's business unit is read under RLS, so an inaccessible
  // candidate is simply not found.
  const { data: candidate, error: candidateError } = await supabase
    .from('candidates')
    .select('business_unit_id')
    .eq('id', input.candidateId)
    .maybeSingle();

  if (candidateError) throw candidateError;
  if (!candidate) throw new AppError('NOT_FOUND', 'Candidate not found or not permitted.');

  const buffer = Buffer.from(input.bytes);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const path = storageKey(input.candidateId, input.documentType, input.fileName);

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: input.mimeType,
    upsert: false,
  });

  if (uploadError) {
    throw new AppError('FORBIDDEN', 'The file could not be stored.');
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      candidate_id: input.candidateId,
      business_unit_id: candidate.business_unit_id,
      document_type: input.documentType,
      file_name: input.fileName,
      storage_bucket: BUCKET,
      storage_path: path,
      mime_type: input.mimeType,
      size_bytes: size,
      checksum_sha256: checksum,
      visibility: input.visibility,
      uploaded_by: actor.userId,
    })
    .select('id')
    .single();

  if (error) {
    // Roll the object back so a rejected metadata write does not leave an
    // orphan behind.
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  if (!data) throw new AppError('INTERNAL', 'The document was not recorded.');

  return { id: data.id };
}

/**
 * Mints a short-lived signed URL for a document.
 *
 * Authorization is not decided here. The metadata read runs under RLS, so a
 * document the caller may not see is not found; the signed URL is then created
 * through the same user-scoped client, which the storage policy gates a second
 * time. Two independent checks, neither of them application logic.
 *
 * Sixty seconds: long enough to start a download, short enough that a URL in a
 * browser history or a proxy log is worthless.
 */
export async function createDownloadUrl(documentId: string): Promise<{
  url: string;
  fileName: string;
}> {
  const supabase = await createServerSupabase();

  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, storage_path, file_name, deleted_at')
    .eq('id', documentId)
    .maybeSingle();

  if (error) throw error;
  if (!doc || doc.deleted_at) throw new AppError('NOT_FOUND', 'Document not found.');

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });

  if (signError || !signed) {
    throw new AppError('FORBIDDEN', 'That document is not available to you.');
  }

  return { url: signed.signedUrl, fileName: doc.file_name };
}

export async function setDocumentVisibility(
  documentId: string,
  visibility: DocumentVisibility,
): Promise<{ id: string }> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('documents')
    .update({ visibility })
    .eq('id', documentId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new AppError('NOT_FOUND', 'Document not found or not permitted.');
  return { id: data.id };
}

export async function listCandidateDocuments(candidateId: string): Promise<DocumentItem[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('documents')
    .select(
      'id, candidate_id, document_type, file_name, mime_type, size_bytes, visibility, version, uploaded_by, uploaded_at',
    )
    .eq('candidate_id', candidateId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  if (error) throw error;

  const rows = data ?? [];
  const uploaderIds = [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name')
      .in('id', uploaderIds);
    for (const u of users ?? []) names.set(u.id, u.full_name);
  }

  return rows.map((r) => ({
    id: r.id,
    candidateId: r.candidate_id,
    documentType: r.document_type,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    visibility: r.visibility as DocumentVisibility,
    version: r.version,
    uploadedByName: r.uploaded_by ? (names.get(r.uploaded_by) ?? null) : null,
    uploadedAt: r.uploaded_at,
  }));
}
