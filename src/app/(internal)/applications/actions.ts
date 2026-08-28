'use server';

import { mutation } from '@/server/auth/mutation';
import {
  ApplicationCreateSchema,
  ApplicationUpdateSchema,
  ApplicationStatusChangeSchema,
} from '@/server/modules/applications/schemas';
import {
  createApplication,
  updateApplication,
  changeApplicationStatus,
} from '@/server/modules/applications/commands';

export const createApplicationAction = mutation({
  name: 'application.create',
  permission: 'application.create',
  schema: ApplicationCreateSchema,
  handler: (input, ctx) => createApplication(input, ctx),
  revalidate: (input) => [
    '/applications',
    '/overview',
    `/candidates/${input.candidateId}`,
    `/candidates/${input.candidateId}/applications`,
    `/candidates/${input.candidateId}/timeline`,
  ],
});

export const updateApplicationAction = mutation({
  name: 'application.update',
  permission: 'application.update',
  schema: ApplicationUpdateSchema,
  handler: (input, ctx) => updateApplication(input, ctx),
  revalidate: (input) => ['/applications', `/applications/${input.applicationId}`],
});

/**
 * Status change is a separate action from editing.
 *
 * It is the transition the business cares about, it writes history and an
 * activity, and burying it in a general save would make an important event look
 * like a field edit.
 */
export const changeApplicationStatusAction = mutation({
  name: 'application.status_change',
  permission: 'application.update',
  schema: ApplicationStatusChangeSchema,
  handler: (input, ctx) => changeApplicationStatus(input, ctx),
  revalidate: (input) => ['/applications', `/applications/${input.applicationId}`, '/overview'],
});
