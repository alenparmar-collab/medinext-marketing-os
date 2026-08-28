import type { ApplicationStatus, SourceKind } from '@/config/statuses';

export interface ApplicationListItem {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateReference: string;
  companyName: string;
  positionTitle: string;
  jobLocation: string | null;
  applicationDate: string;
  status: ApplicationStatus;
  sourceType: SourceKind;
  isVerified: boolean;
}

export interface ApplicationStatusHistoryItem {
  id: string;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus;
  changedAt: string;
  changedByName: string | null;
  sourceType: SourceKind;
  note: string | null;
}

export interface ApplicationDetail {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateReference: string;
  businessUnitId: string;
  companyName: string;
  positionTitle: string;
  jobId: string | null;
  jobUrl: string | null;
  jobLocation: string | null;
  applicationDate: string;
  status: ApplicationStatus;
  notes: string | null;
  sourceType: SourceKind;
  sourceReference: string | null;
  isVerified: boolean;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory: ApplicationStatusHistoryItem[];
}
