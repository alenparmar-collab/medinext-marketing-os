import type { MarketingStatus, AssignmentType } from '@/config/statuses';

/**
 * DTOs, not database rows.
 *
 * Queries return these rather than raw rows so that a column rename is not a UI
 * change, and — more importantly — so an internal column cannot drift into a
 * payload that reaches a candidate.
 */
/**
 * Counts are DERIVED from records, never stored. There are no cached totals
 * anywhere in this product, so a figure on screen can always be traced to the
 * rows that produced it.
 */
export interface CandidateCounts {
  applications: number;
  recruiterResponses: number;
  interviews: number;
  assessments: number;
  rejections: number;
  offers: number;
}

export const EMPTY_COUNTS: CandidateCounts = {
  applications: 0,
  recruiterResponses: 0,
  interviews: 0,
  assessments: 0,
  rejections: 0,
  offers: 0,
};

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
  /** Active assignees, primary first. Empty when nobody is assigned. */
  recruiters: string[];
  counts: CandidateCounts;
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
  businessUnitId: string;
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
  counts: CandidateCounts;
}

export interface CandidateListPage {
  items: CandidateListItem[];
  nextCursor: string | null;
}
