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

/* ===========================================================================
 * APPLICATIONS
 *
 * The controlled status model. Centralised here so no status string is ever
 * written into a component — the UI renders through APPLICATION_STATUS_META and
 * nothing else decides what a status looks like or is called.
 * =========================================================================== */
export const APPLICATION_STATUSES = [
  'submitted',
  'recruiter_response',
  'screening',
  'interview',
  'assessment',
  'offer',
  'rejected',
  'withdrawn',
  'closed',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_META: Record<
  ApplicationStatus,
  { label: string; tone: StatusTone; order: number; isTerminal: boolean }
> = {
  submitted:          { label: 'Submitted',          tone: 'info',     order: 10, isTerminal: false },
  recruiter_response: { label: 'Recruiter response', tone: 'info',     order: 20, isTerminal: false },
  screening:          { label: 'Screening',          tone: 'info',     order: 30, isTerminal: false },
  interview:          { label: 'Interview',          tone: 'positive', order: 40, isTerminal: false },
  assessment:         { label: 'Assessment',         tone: 'positive', order: 50, isTerminal: false },
  offer:              { label: 'Offer',              tone: 'positive', order: 60, isTerminal: false },
  rejected:           { label: 'Rejected',           tone: 'caution',  order: 70, isTerminal: true },
  withdrawn:          { label: 'Withdrawn',          tone: 'muted',    order: 80, isTerminal: true },
  closed:             { label: 'Closed',             tone: 'muted',    order: 90, isTerminal: true },
};

/** Ordered for pickers and boards; terminal states last. */
export const APPLICATION_STATUSES_ORDERED = [...APPLICATION_STATUSES].sort(
  (a, b) => APPLICATION_STATUS_META[a].order - APPLICATION_STATUS_META[b].order,
);

/* ===========================================================================
 * MARKETING ACTIVITIES
 *
 * The chronological event vocabulary. This is the aggregation source: counts
 * come from these records, never from a total someone typed in.
 * =========================================================================== */
export const ACTIVITY_TYPES = [
  'application_submitted',
  'recruiter_response',
  'interview',
  'assessment',
  'rejection',
  'offer',
  'follow_up',
  'note',
  'status_change',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_META: Record<
  ActivityType,
  {
    label: string;
    tone: StatusTone;
    /** Whether a person may create this by hand. */
    manuallyLoggable: boolean;
    /** Whether the candidate sees it in their portal timeline by default. */
    candidateVisible: boolean;
  }
> = {
  application_submitted: { label: 'Application submitted', tone: 'info',     manuallyLoggable: false, candidateVisible: true },
  recruiter_response:    { label: 'Recruiter response',    tone: 'info',     manuallyLoggable: true,  candidateVisible: true },
  interview:             { label: 'Interview',             tone: 'positive', manuallyLoggable: true,  candidateVisible: true },
  assessment:            { label: 'Assessment',            tone: 'positive', manuallyLoggable: true,  candidateVisible: true },
  rejection:             { label: 'Rejection',             tone: 'caution',  manuallyLoggable: true,  candidateVisible: true },
  offer:                 { label: 'Offer',                 tone: 'positive', manuallyLoggable: true,  candidateVisible: true },
  follow_up:             { label: 'Follow-up',             tone: 'neutral',  manuallyLoggable: true,  candidateVisible: true },
  note:                  { label: 'Internal note',         tone: 'muted',    manuallyLoggable: true,  candidateVisible: false },
  status_change:         { label: 'Status change',         tone: 'neutral',  manuallyLoggable: false, candidateVisible: true },
};

/**
 * The types a person may record by hand.
 *
 * application_submitted and status_change are excluded because the database
 * writes them automatically when an application is created or its status
 * changes. Offering them here would let someone log an application that does
 * not exist, and the counts would stop matching the records.
 */
export const MANUAL_ACTIVITY_TYPES = ACTIVITY_TYPES.filter(
  (t) => ACTIVITY_TYPE_META[t].manuallyLoggable,
);

/* ===========================================================================
 * PROVENANCE
 *
 * Where a record came from. Build 3 writes only 'manual' and 'seed'; the rest
 * exist so later builds do not have to alter a type on populated tables.
 * =========================================================================== */
export const SOURCE_KINDS = [
  'manual',
  'seed',
  'excel_import',
  'email_event',
  'system',
  'api',
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_META: Record<SourceKind, { label: string; tone: StatusTone }> = {
  manual:       { label: 'Entered manually', tone: 'neutral' },
  seed:         { label: 'Demo data',        tone: 'muted' },
  excel_import: { label: 'Imported',         tone: 'neutral' },
  email_event:  { label: 'From email',       tone: 'info' },
  system:       { label: 'System',           tone: 'neutral' },
  api:          { label: 'API',              tone: 'neutral' },
};

/* ===========================================================================
 * INTERVIEWS
 *
 * Centralised so no status string is written into a component. The UI renders
 * through INTERVIEW_STATUS_META and nothing else decides what a status is
 * called or how it looks.
 * =========================================================================== */
export const INTERVIEW_STATUSES = [
  'scheduled',
  'completed',
  'rescheduled',
  'cancelled',
  'no_show',
  'passed',
  'failed',
] as const;

export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const INTERVIEW_STATUS_META: Record<
  InterviewStatus,
  { label: string; tone: StatusTone; order: number; isUpcoming: boolean }
> = {
  scheduled:   { label: 'Scheduled',   tone: 'info',     order: 10, isUpcoming: true },
  rescheduled: { label: 'Rescheduled', tone: 'caution',  order: 20, isUpcoming: true },
  completed:   { label: 'Completed',   tone: 'neutral',  order: 30, isUpcoming: false },
  passed:      { label: 'Passed',      tone: 'positive', order: 40, isUpcoming: false },
  failed:      { label: 'Failed',      tone: 'caution',  order: 50, isUpcoming: false },
  no_show:     { label: 'No show',     tone: 'caution',  order: 60, isUpcoming: false },
  cancelled:   { label: 'Cancelled',   tone: 'muted',    order: 70, isUpcoming: false },
};

/** Statuses that mean the interview has not happened yet. */
export const UPCOMING_INTERVIEW_STATUSES = INTERVIEW_STATUSES.filter(
  (s) => INTERVIEW_STATUS_META[s].isUpcoming,
);

export const INTERVIEW_STATUSES_ORDERED = [...INTERVIEW_STATUSES].sort(
  (a, b) => INTERVIEW_STATUS_META[a].order - INTERVIEW_STATUS_META[b].order,
);

/* ===========================================================================
 * ASSESSMENTS
 * =========================================================================== */
export const ASSESSMENT_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'expired',
  'passed',
  'failed',
] as const;

export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_STATUS_META: Record<
  AssessmentStatus,
  { label: string; tone: StatusTone; order: number; isOpen: boolean }
> = {
  pending:     { label: 'Pending',     tone: 'info',     order: 10, isOpen: true },
  in_progress: { label: 'In progress', tone: 'info',     order: 20, isOpen: true },
  completed:   { label: 'Completed',   tone: 'neutral',  order: 30, isOpen: false },
  passed:      { label: 'Passed',      tone: 'positive', order: 40, isOpen: false },
  failed:      { label: 'Failed',      tone: 'caution',  order: 50, isOpen: false },
  expired:     { label: 'Expired',     tone: 'muted',    order: 60, isOpen: false },
};

/** Statuses that still need something from the candidate. */
export const OPEN_ASSESSMENT_STATUSES = ASSESSMENT_STATUSES.filter(
  (s) => ASSESSMENT_STATUS_META[s].isOpen,
);

export const ASSESSMENT_STATUSES_ORDERED = [...ASSESSMENT_STATUSES].sort(
  (a, b) => ASSESSMENT_STATUS_META[a].order - ASSESSMENT_STATUS_META[b].order,
);

/* ===========================================================================
 * NOTIFICATIONS
 * =========================================================================== */
export const NOTIFICATION_TYPES = [
  'interview_scheduled',
  'interview_updated',
  'interview_cancelled',
  'assessment_received',
  'assessment_updated',
  'application_updated',
  'important_marketing_update',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_META: Record<
  NotificationType,
  { label: string; tone: StatusTone }
> = {
  interview_scheduled:        { label: 'Interview scheduled', tone: 'info' },
  interview_updated:          { label: 'Interview updated',   tone: 'caution' },
  interview_cancelled:        { label: 'Interview cancelled', tone: 'muted' },
  assessment_received:        { label: 'Assessment received', tone: 'info' },
  assessment_updated:         { label: 'Assessment updated',  tone: 'caution' },
  application_updated:        { label: 'Application updated', tone: 'neutral' },
  important_marketing_update: { label: 'Marketing update',    tone: 'info' },
};

/**
 * Where a notification points. Kept here so the notification centre resolves a
 * link from data rather than a switch buried in a component.
 */
export function notificationHref(
  entityType: string | null,
  entityId: string | null,
  audience: 'internal' | 'portal',
): string | null {
  if (!entityType || !entityId) return null;

  if (audience === 'portal') {
    switch (entityType) {
      case 'interview':
        return '/portal/interviews';
      case 'assessment':
        return '/portal/assessments';
      case 'application':
        return '/portal/applications';
      default:
        return null;
    }
  }

  switch (entityType) {
    case 'application':
      return `/applications/${entityId}`;
    case 'interview':
      return '/interviews';
    case 'assessment':
      return '/assessments';
    default:
      return null;
  }
}

/* ===========================================================================
 * DAILY REPORTS
 *
 * A report is a reconciliation snapshot. Its figures are derived from the
 * records; the recruiter contributes judgement, not numbers.
 * =========================================================================== */
export const DAILY_REPORT_STATUSES = ['draft', 'confirmed'] as const;
export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];

export const DAILY_REPORT_STATUS_META: Record<
  DailyReportStatus,
  { label: string; tone: StatusTone }
> = {
  draft: { label: 'Draft', tone: 'caution' },
  confirmed: { label: 'Confirmed', tone: 'positive' },
};

/**
 * The five figures, in the order they are shown everywhere.
 *
 * Centralised so the daily-report table, the detail page and the team view
 * cannot drift apart on labels or ordering.
 */
export const DAILY_REPORT_METRICS = [
  { key: 'applications', label: 'Applications' },
  { key: 'recruiterResponses', label: 'Responses' },
  { key: 'interviews', label: 'Interviews' },
  { key: 'assessments', label: 'Assessments' },
  { key: 'rejections', label: 'Rejections' },
] as const;

export type DailyReportMetricKey = (typeof DAILY_REPORT_METRICS)[number]['key'];

/* ===========================================================================
 * REVIEW QUEUE
 *
 * NEUTRAL LANGUAGE THROUGHOUT.
 *
 * A review item says a person should look at something. It never asserts that
 * anyone did anything wrong, and none of these labels implies fault. The
 * database enums carry the same vocabulary and a test asserts no accusatory
 * word reaches a reason string.
 * =========================================================================== */
export const REVIEW_ITEM_TYPES = [
  'incomplete_record',
  'possible_duplicate',
  'uncertain_activity',
  'missing_information',
  'ambiguous_source',
  'failed_automation',
  'conflicting_information',
] as const;

export type ReviewItemType = (typeof REVIEW_ITEM_TYPES)[number];

export const REVIEW_ITEM_TYPE_META: Record<ReviewItemType, { label: string; tone: StatusTone }> = {
  incomplete_record:       { label: 'Incomplete record',       tone: 'info' },
  possible_duplicate:      { label: 'Possible duplicate',      tone: 'caution' },
  uncertain_activity:      { label: 'Uncertain activity',      tone: 'caution' },
  missing_information:     { label: 'Missing information',     tone: 'info' },
  ambiguous_source:        { label: 'Ambiguous source',        tone: 'caution' },
  failed_automation:       { label: 'Automation did not run',  tone: 'caution' },
  conflicting_information: { label: 'Conflicting information', tone: 'caution' },
};

export const REVIEW_ITEM_STATUSES = ['open', 'in_review', 'resolved', 'dismissed'] as const;
export type ReviewItemStatus = (typeof REVIEW_ITEM_STATUSES)[number];

export const REVIEW_ITEM_STATUS_META: Record<
  ReviewItemStatus,
  { label: string; tone: StatusTone; isOpen: boolean }
> = {
  open:      { label: 'Open',        tone: 'info',     isOpen: true },
  in_review: { label: 'In review',   tone: 'caution',  isOpen: true },
  resolved:  { label: 'Resolved',    tone: 'positive', isOpen: false },
  dismissed: { label: 'Dismissed',   tone: 'muted',    isOpen: false },
};

export const REVIEW_ITEM_PRIORITIES = ['low', 'normal', 'high'] as const;
export type ReviewItemPriority = (typeof REVIEW_ITEM_PRIORITIES)[number];

export const REVIEW_ITEM_PRIORITY_META: Record<
  ReviewItemPriority,
  { label: string; tone: StatusTone; order: number }
> = {
  high:   { label: 'High',   tone: 'caution', order: 1 },
  normal: { label: 'Normal', tone: 'neutral', order: 2 },
  low:    { label: 'Low',    tone: 'muted',   order: 3 },
};

export const REVIEW_RESOLUTIONS = [
  'corrected',
  'confirmed_correct',
  'merged',
  'no_action_needed',
] as const;

export type ReviewResolution = (typeof REVIEW_RESOLUTIONS)[number];

export const REVIEW_RESOLUTION_META: Record<ReviewResolution, { label: string }> = {
  corrected:         { label: 'Corrected the record' },
  confirmed_correct: { label: 'Checked — the record is correct' },
  merged:            { label: 'Merged with another record' },
  no_action_needed:  { label: 'No action needed' },
};

/* ===========================================================================
 * USER ACCOUNTS
 * =========================================================================== */
export const USER_STATUSES = ['invited', 'active', 'suspended', 'disabled'] as const;
export type UserAccountStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_META: Record<
  UserAccountStatus,
  { label: string; tone: StatusTone; canSignIn: boolean }
> = {
  active:    { label: 'Active',    tone: 'positive', canSignIn: true },
  invited:   { label: 'Invited',   tone: 'info',     canSignIn: false },
  suspended: { label: 'Suspended', tone: 'caution',  canSignIn: false },
  disabled:  { label: 'Disabled',  tone: 'muted',    canSignIn: false },
};

/* ===========================================================================
 * EMAIL EVIDENCE (Build 6)
 *
 * Note what the processing states deliberately do NOT include: nothing here
 * says "classified", "extracted", "matched" or "interpreted". Build 6 has no
 * interpretation layer, so a status implying one would be a label with nothing
 * behind it — and a status that lies is worse than a status that is missing.
 * =========================================================================== */
export const EMAIL_PROVIDERS = ['gmail', 'microsoft', 'imap'] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

export const EMAIL_PROVIDER_LABELS: Record<EmailProvider, string> = {
  gmail: 'Google Workspace',
  microsoft: 'Microsoft 365',
  imap: 'IMAP',
};

export const MAILBOX_STATUSES = ['disconnected', 'connected', 'error', 'revoked'] as const;
export type MailboxStatus = (typeof MAILBOX_STATUSES)[number];

export const MAILBOX_STATUS_META: Record<
  MailboxStatus,
  { label: string; tone: StatusTone; description: string }
> = {
  connected: {
    label: 'Connected',
    tone: 'positive',
    description: 'Authorised and synchronising.',
  },
  error: {
    label: 'Sync failing',
    tone: 'caution',
    description: 'Still authorised, but the last attempt did not complete.',
  },
  revoked: {
    label: 'Access withdrawn',
    tone: 'caution',
    description: 'The provider rejected our credentials. Reconnect the mailbox.',
  },
  disconnected: {
    label: 'Not connected',
    tone: 'muted',
    description: 'No mailbox is authorised.',
  },
};

export const EMAIL_PROCESSING_STATUSES = [
  'received',
  'stored',
  'ready',
  'processing',
  'failed',
] as const;
export type EmailProcessingStatus = (typeof EMAIL_PROCESSING_STATUSES)[number];

export const EMAIL_PROCESSING_STATUS_META: Record<
  EmailProcessingStatus,
  { label: string; tone: StatusTone; description: string }
> = {
  received:   { label: 'Received',   tone: 'info',     description: 'The provider told us it exists.' },
  stored:     { label: 'Stored',     tone: 'info',     description: 'Normalised and preserved.' },
  ready:      { label: 'Ready',      tone: 'positive', description: 'Complete evidence, available to later processing.' },
  processing: { label: 'Processing', tone: 'caution',  description: 'Claimed by a worker.' },
  failed:     { label: 'Failed',     tone: 'caution',  description: 'Ingestion did not complete. See the reason.' },
};

export const EMAIL_SYNC_STATUSES = ['running', 'succeeded', 'failed'] as const;
export type EmailSyncStatus = (typeof EMAIL_SYNC_STATUSES)[number];

export const EMAIL_SYNC_STATUS_META: Record<EmailSyncStatus, { label: string; tone: StatusTone }> = {
  running:   { label: 'Running',   tone: 'info' },
  succeeded: { label: 'Succeeded', tone: 'positive' },
  failed:    { label: 'Failed',    tone: 'caution' },
};

export const EMAIL_SYNC_TRIGGERS = ['initial', 'manual', 'scheduled'] as const;
export type EmailSyncTrigger = (typeof EMAIL_SYNC_TRIGGERS)[number];

export const EMAIL_SYNC_TRIGGER_LABELS: Record<EmailSyncTrigger, string> = {
  initial: 'First sync',
  manual: 'Started by hand',
  scheduled: 'Scheduled',
};
