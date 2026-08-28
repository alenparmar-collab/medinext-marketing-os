'use server';

import { mutation } from '@/server/auth/mutation';
import { NoteCreateSchema, NoteUpdateSchema } from '@/server/modules/notes/schemas';
import { createInternalNote, updateInternalNote } from '@/server/modules/notes';
import { ActivityCreateSchema } from '@/server/modules/activities/schemas';
import { createActivity } from '@/server/modules/activities/commands';

/**
 * Every mutation goes through the existing pipeline: actor resolution,
 * capability check against the tables, Zod validation, then the command. The
 * audit trigger captures the write itself, so no action needs to remember to
 * log anything.
 */
export const createNoteAction = mutation({
  name: 'note.create',
  permission: 'note.write',
  schema: NoteCreateSchema,
  handler: (input, ctx) => createInternalNote(input, ctx),
  revalidate: (input) => [`/candidates/${input.candidateId}`],
});

export const updateNoteAction = mutation({
  name: 'note.update',
  permission: 'note.write',
  schema: NoteUpdateSchema,
  handler: (input, ctx) => updateInternalNote(input, ctx),
  revalidate: () => ['/candidates'],
});

export const createActivityAction = mutation({
  name: 'activity.create',
  permission: 'activity.create',
  schema: ActivityCreateSchema,
  handler: (input, ctx) => createActivity(input, ctx),
  revalidate: (input) => [
    `/candidates/${input.candidateId}`,
    `/candidates/${input.candidateId}/marketing`,
    `/candidates/${input.candidateId}/timeline`,
  ],
});
