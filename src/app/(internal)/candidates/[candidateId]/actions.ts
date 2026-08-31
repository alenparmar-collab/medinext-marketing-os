'use server';

import { mutation } from '@/server/auth/mutation';
import { NoteCreateSchema, NoteUpdateSchema } from '@/server/modules/notes/schemas';
import { createInternalNote, updateInternalNote } from '@/server/modules/notes';
import { ActivityCreateSchema } from '@/server/modules/activities/schemas';
import { createActivity } from '@/server/modules/activities/commands';
import {
  AssignmentCreateSchema,
  AssignmentEndSchema,
  AssignmentTransferSchema,
} from '@/server/modules/assignments/schemas';
import {
  createAssignment,
  endAssignment,
  transferAssignment,
} from '@/server/modules/assignments/commands';

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

/**
 * Assignment changes.
 *
 * `candidate.assign` is held by managers and administrators, not recruiters —
 * so a recruiter cannot put themselves on a candidate they are not already
 * working. That is a property of the permission matrix, checked here and again
 * by the RLS policy on candidate_assignments.
 */
export const assignCandidateAction = mutation({
  name: 'assignment.create',
  permission: 'candidate.assign',
  schema: AssignmentCreateSchema,
  handler: (input, ctx) => createAssignment(input, ctx),
  revalidate: (input) => [
    `/candidates/${input.candidateId}`,
    `/candidates/${input.candidateId}/assignments`,
    '/candidates',
    '/team',
  ],
});

/**
 * Reassignment is one action rather than an end followed by a create, because
 * the two halves must not be separable: between them the candidate would have
 * nobody working their file.
 */
export const reassignCandidateAction = mutation({
  name: 'assignment.transfer',
  permission: 'candidate.assign',
  schema: AssignmentTransferSchema,
  handler: (input, ctx) => transferAssignment(input, ctx),
  revalidate: (input) => [
    `/candidates/${input.candidateId}`,
    `/candidates/${input.candidateId}/assignments`,
    '/candidates',
    '/team',
  ],
});

/**
 * Ending an assignment keeps the row. Access is revoked immediately because
 * every policy tests `ends_on is null`, but the history of who was accountable
 * on any given day survives.
 */
export const endAssignmentAction = mutation({
  name: 'assignment.end',
  permission: 'candidate.assign',
  schema: AssignmentEndSchema,
  handler: (input, ctx) => endAssignment(input, ctx),
  revalidate: () => ['/candidates', '/team'],
});
