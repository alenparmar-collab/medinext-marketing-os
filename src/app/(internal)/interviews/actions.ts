'use server';

import { mutation } from '@/server/auth/mutation';
import {
  InterviewCreateSchema,
  InterviewUpdateSchema,
  InterviewRescheduleSchema,
  InterviewStatusSchema,
} from '@/server/modules/interviews/schemas';
import {
  createInterview,
  updateInterview,
  rescheduleInterview,
  setInterviewStatus,
} from '@/server/modules/interviews/commands';
import {
  AssessmentCreateSchema,
  AssessmentUpdateSchema,
  AssessmentStatusSchema,
} from '@/server/modules/assessments/schemas';
import {
  createAssessment,
  updateAssessment,
  setAssessmentStatus,
} from '@/server/modules/assessments/commands';

/**
 * Every mutation runs through the existing pipeline, so the audit trigger
 * captures the write and no action has to remember to log anything.
 */
const interviewPaths = (candidateId?: string) => [
  '/interviews',
  '/overview',
  ...(candidateId
    ? [`/candidates/${candidateId}/marketing`, `/candidates/${candidateId}/timeline`]
    : []),
];

export const createInterviewAction = mutation({
  name: 'interview.create',
  permission: 'interview.manage',
  schema: InterviewCreateSchema,
  handler: (input, ctx) => createInterview(input, ctx),
  revalidate: () => interviewPaths(),
});

export const updateInterviewAction = mutation({
  name: 'interview.update',
  permission: 'interview.manage',
  schema: InterviewUpdateSchema,
  handler: (input, ctx) => updateInterview(input, ctx),
  revalidate: () => interviewPaths(),
});

/**
 * Rescheduling is its own action: it writes history and notifies the candidate,
 * so it must not look like editing a field.
 */
export const rescheduleInterviewAction = mutation({
  name: 'interview.reschedule',
  permission: 'interview.manage',
  schema: InterviewRescheduleSchema,
  handler: (input, ctx) => rescheduleInterview(input, ctx),
  revalidate: () => interviewPaths(),
});

export const setInterviewStatusAction = mutation({
  name: 'interview.status',
  permission: 'interview.manage',
  schema: InterviewStatusSchema,
  handler: (input, ctx) => setInterviewStatus(input, ctx),
  revalidate: () => interviewPaths(),
});

export const createAssessmentAction = mutation({
  name: 'assessment.create',
  permission: 'assessment.manage',
  schema: AssessmentCreateSchema,
  handler: (input, ctx) => createAssessment(input, ctx),
  revalidate: () => ['/assessments', '/overview'],
});

export const updateAssessmentAction = mutation({
  name: 'assessment.update',
  permission: 'assessment.manage',
  schema: AssessmentUpdateSchema,
  handler: (input, ctx) => updateAssessment(input, ctx),
  revalidate: () => ['/assessments'],
});

export const setAssessmentStatusAction = mutation({
  name: 'assessment.status',
  permission: 'assessment.manage',
  schema: AssessmentStatusSchema,
  handler: (input, ctx) => setAssessmentStatus(input, ctx),
  revalidate: () => ['/assessments', '/overview'],
});
