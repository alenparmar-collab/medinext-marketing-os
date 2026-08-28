/**
 * Status vocabulary and presentation.
 *
 * This is the ONLY place a status colour is decided. Every badge in the product
 * renders through it, which is what keeps colour meaningful rather than
 * decorative — and what stops two screens disagreeing about what "on hold"
 * looks like.
 */
export const MARKETING_STATUSES = [
  'onboarding',
  'ready_for_marketing',
  'active',
  'paused',
  'completed',
  'on_hold',
  'closed',
] as const;

export type MarketingStatus = (typeof MARKETING_STATUSES)[number];

/** Semantic tone, not a colour. The badge component maps tone to tokens. */
export type StatusTone = 'neutral' | 'info' | 'positive' | 'caution' | 'muted';

export const MARKETING_STATUS_META: Record<
  MarketingStatus,
  { label: string; tone: StatusTone; order: number }
> = {
  onboarding: { label: 'Onboarding', tone: 'info', order: 10 },
  ready_for_marketing: { label: 'Ready for marketing', tone: 'info', order: 20 },
  active: { label: 'Active', tone: 'positive', order: 30 },
  paused: { label: 'Paused', tone: 'caution', order: 40 },
  on_hold: { label: 'On hold', tone: 'caution', order: 50 },
  completed: { label: 'Completed', tone: 'muted', order: 60 },
  closed: { label: 'Closed', tone: 'muted', order: 70 },
};

export const ASSIGNMENT_TYPES = [
  'primary_recruiter',
  'secondary_recruiter',
  'manager',
] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  primary_recruiter: 'Primary recruiter',
  secondary_recruiter: 'Secondary recruiter',
  manager: 'Marketing manager',
};

export const DOCUMENT_VISIBILITIES = ['internal', 'candidate_visible'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];
