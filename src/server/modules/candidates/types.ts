import type { MarketingStatus, AssignmentType } from '@/config/statuses';

/**
 * DTOs, not database rows.
 *
 * Queries return these rather than raw rows so that a column rename is not a UI
 * change, and — more importantly — so an internal column cannot drift into a
 * payload that reaches a candidate.
 */
export interface CandidateListItem {
  id: string;
  reference: string;
  fullName: string;
  email: string;
  primarySkill: string | null;
  currentLocation: string | null;
  marketingStatus: MarketingStatus;
  experienceMonths: number | null;
  hasPortalAccess: boolean;
  isArchived: boolean;
  updatedAt: string;
}

export interface CandidateAssignmentSummary {
  id: string;
  userId: string;
  userName: string;
  assignmentType: AssignmentType;
  startsOn: string;
  endsOn: string | null;
  isActive: boolean;
}

export interface MarketingPeriodSummary {
  id: string;
  startsOn: string;
  endsOn: string | null;
  status: MarketingStatus;
  objective: string | null;
}

export interface CandidateDocumentSummary {
  id: string;
  documentType: string;
  fileName: string;
  sizeBytes: number;
  visibility: 'internal' | 'candidate_visible';
  version: number;
  uploadedAt: string;
}

export interface CandidateDetail {
  id: string;
  reference: string;
  fullName: string;
  email: string;
  phone: string | null;
  primarySkill: string | null;
  skills: string[];
  experienceMonths: number | null;
  currentLocation: string | null;
  visaStatus: string | null;
  education: string | null;
  certifications: string[];
  /** May be empty. That is a normal, complete candidate record. */
  preferredLocations: string[];
  marketingStatus: MarketingStatus;
  hasPortalAccess: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  assignments: CandidateAssignmentSummary[];
  marketingPeriods: MarketingPeriodSummary[];
  documents: CandidateDocumentSummary[];
}

export interface CandidateListPage {
  items: CandidateListItem[];
  nextCursor: string | null;
}
