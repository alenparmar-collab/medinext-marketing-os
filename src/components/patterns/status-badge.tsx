import { Badge } from '@/components/ui/badge';
import {
  MARKETING_STATUS_META,
  APPLICATION_STATUS_META,
  ACTIVITY_TYPE_META,
  SOURCE_KIND_META,
  INTERVIEW_STATUS_META,
  ASSESSMENT_STATUS_META,
  NOTIFICATION_TYPE_META,
  type MarketingStatus,
  type ApplicationStatus,
  type ActivityType,
  type SourceKind,
  type InterviewStatus,
  type AssessmentStatus,
  type NotificationType,
} from '@/config/statuses';

/**
 * The single place a marketing status is rendered.
 *
 * Centralising this is a correctness measure, not a DRY preference: it is what
 * keeps status colour meaningful and stops two screens describing the same
 * state differently.
 */
export function MarketingStatusBadge({ status }: { status: MarketingStatus }) {
  const meta = MARKETING_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * The single place an application status is rendered.
 *
 * No component anywhere writes a status string or picks a status colour. That
 * is what keeps colour meaningful and stops two screens describing the same
 * state differently.
 */
export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const meta = APPLICATION_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function ActivityTypeBadge({ type }: { type: ActivityType }) {
  const meta = ACTIVITY_TYPE_META[type];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/**
 * Where a record came from.
 *
 * Shown only when it is NOT ordinary manual entry — a badge on every row would
 * be noise today, and becomes meaningful the moment the email pipeline starts
 * creating records alongside people.
 */
export function SourceBadge({
  source,
  isVerified,
}: {
  source: SourceKind;
  isVerified?: boolean;
}) {
  if (source === 'manual' && isVerified !== false) return null;
  const meta = SOURCE_KIND_META[source];
  return (
    <Badge tone={isVerified === false ? 'caution' : meta.tone}>
      {isVerified === false ? `${meta.label} · unverified` : meta.label}
    </Badge>
  );
}

export function InterviewStatusBadge({ status }: { status: InterviewStatus }) {
  const meta = INTERVIEW_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function AssessmentStatusBadge({ status }: { status: AssessmentStatus }) {
  const meta = ASSESSMENT_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function NotificationTypeBadge({ type }: { type: NotificationType }) {
  const meta = NOTIFICATION_TYPE_META[type];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
