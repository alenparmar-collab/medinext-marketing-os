'use server';

import { randomUUID } from 'node:crypto';
import { requireCandidate } from '@/server/auth/actor';
import { uploadDocument } from '@/server/modules/documents';
import { DocumentUploadSchema } from '@/server/modules/documents/schemas';
import { revalidatePath } from 'next/cache';
import { AppError, USER_FACING_MESSAGE, type Result } from '@/server/auth/errors';

/**
 * The one portal write path in the product.
 *
 * It does not use the `mutation` pipeline because that pipeline is built around
 * a permission code, and a candidate holds none — their authority comes from
 * the RLS path keyed on their own candidate id, not from the permission matrix.
 * Everything else the pipeline does is reproduced here explicitly: actor
 * resolution, validation, typed errors, no exceptions crossing the boundary.
 *
 * The candidate id is taken from the SESSION, never from the form.
 */
export async function uploadOwnDocumentAction(
  formData: FormData,
): Promise<Result<{ id: string }>> {
  const requestId = randomUUID();

  try {
    const actor = await requireCandidate();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return {
        ok: false,
        code: 'VALIDATION',
        message: 'Choose a file to upload.',
        fieldErrors: { file: ['Choose a file to upload.'] },
        requestId,
      };
    }

    const parsed = DocumentUploadSchema.safeParse({
      candidateId: actor.candidateId,
      documentType: formData.get('documentType'),
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });

    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_form';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return {
        ok: false,
        code: 'VALIDATION',
        message: USER_FACING_MESSAGE.VALIDATION,
        fieldErrors,
        requestId,
      };
    }

    const result = await uploadDocument(
      {
        candidateId: actor.candidateId,
        documentType: parsed.data.documentType,
        fileName: parsed.data.fileName,
        mimeType: parsed.data.mimeType,
        bytes: await file.arrayBuffer(),
        // A candidate's own upload is theirs to see. They cannot create an
        // internal-only record — the RLS policy forbids it.
        visibility: 'candidate_visible',
      },
      actor,
    );

    revalidatePath('/portal/documents');
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        ok: false,
        code: error.code,
        message: USER_FACING_MESSAGE[error.code],
        requestId,
      };
    }
    console.error(JSON.stringify({ level: 'error', requestId, action: 'portal.document.upload' }));
    return { ok: false, code: 'INTERNAL', message: USER_FACING_MESSAGE.INTERNAL, requestId };
  }
}
