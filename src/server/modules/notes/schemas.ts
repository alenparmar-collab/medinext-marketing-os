import { z } from 'zod';
import { uuid, requiredText } from '@/lib/validation/primitives';

export const NoteCreateSchema = z.object({
  candidateId: uuid,
  body: requiredText('Note', 4000),
});

export type NoteCreateInput = z.infer<typeof NoteCreateSchema>;

export const NoteUpdateSchema = z.object({
  noteId: uuid,
  body: requiredText('Note', 4000),
});

export type NoteUpdateInput = z.infer<typeof NoteUpdateSchema>;
