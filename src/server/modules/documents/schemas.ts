import { z } from 'zod';
import { uuid } from '@/lib/validation/primitives';

/**
 * Upload constraints, enforced here AND by the storage bucket configuration.
 *
 * Duplicating them is deliberate: Zod produces the message a person can act on,
 * and the bucket produces the guarantee that holds even if a request bypasses
 * this code entirely.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
] as const;

export const DocumentUploadSchema = z.object({
  candidateId: uuid,
  documentType: z.string().trim().min(1, 'Choose a document type').max(64),
  fileName: z
    .string()
    .trim()
    .min(1, 'File name is required')
    .max(255)
    // Path separators and traversal segments must never reach a storage key.
    .refine((v) => !v.includes('/') && !v.includes('\\') && !v.includes('..'), {
      message: 'File name contains characters that are not allowed',
    }),
  mimeType: z.string().refine((v) => (ALLOWED_MIME_TYPES as readonly string[]).includes(v), {
    message: 'That file type is not accepted. Upload a PDF, Word document, PNG or JPEG.',
  }),
  sizeBytes: z
    .number()
    .int()
    .positive('The file appears to be empty')
    .max(MAX_UPLOAD_BYTES, 'Files must be 25 MB or smaller'),
});

export type DocumentUploadInput = z.infer<typeof DocumentUploadSchema>;

export const DocumentDownloadSchema = z.object({ documentId: uuid });
export const DocumentVisibilitySchema = z.object({
  documentId: uuid,
  visibility: z.enum(['internal', 'candidate_visible']),
});
