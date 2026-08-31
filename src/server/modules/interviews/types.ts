import type { InterviewStatus, SourceKind } from '@/config/statuses';

export interface InterviewListItem {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateReference: string;
  applicationId: string;
  companyName: string;
  positionTitle: string;
  interviewRound: number;
  scheduledAt: string | null;
  timeZone: string | null;
  meetingUrl: string | null;
  interviewerName: string | null;
  status: InterviewStatus;
  sourceType: SourceKind;
  isVerified: boolean;
  /**
   * Decided here rather than in each page: "has this happened yet" is a
   * property of the record, and recomputing it per view invites two screens to
   * disagree. It also keeps clock reads out of render.
   */
  isUpcoming: boolean;
}

export interface InterviewScheduleChange {
  id: string;
  changeKind: string;
  previousScheduledAt: string | null;
  previousTimeZone: string | null;
  newScheduledAt: string | null;
  newTimeZone: string | null;
  previousStatus: InterviewStatus | null;
  newStatus: InterviewStatus | null;
  reason: string | null;
  changedAt: string;
  changedByName: string | null;
}

export interface InterviewDetail extends InterviewListItem {
  notes: string | null;
  interviewerEmail: string | null;
  history: InterviewScheduleChange[];
}
