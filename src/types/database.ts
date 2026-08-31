/**
 * Database types.
 *
 * Hand-maintained for Build 2 because the Supabase CLI is not part of this
 * environment. Regenerate against a real project with:
 *
 *     npm run db:types
 *
 * CI should fail if regenerating produces a diff — that check is what stops the
 * TypeScript model and the actual schema drifting apart, which is the failure
 * that makes generated types feel untrustworthy.
 */
/*
 * NOTE: every shape below is a `type` alias, never an `interface`.
 *
 * Supabase constrains a schema to Record<string, GenericTable>, whose Row must
 * satisfy Record<string, unknown>. TypeScript gives type aliases an implicit
 * index signature but does NOT give one to interfaces, so declaring these as
 * interfaces makes the schema fail that constraint and every query silently
 * resolves to `never`. Keep them as type aliases.
 */
import type {
  MarketingStatus,
  AssignmentType,
  DocumentVisibility,
  ApplicationStatus,
  ActivityType,
  InterviewStatus,
  AssessmentStatus,
  NotificationType,
} from '@/config/statuses';
import type { RoleCode } from '@/config/permissions';

export type SourceKind = 'manual' | 'seed' | 'excel_import' | 'email_event' | 'system' | 'api';
export type UserStatus = 'invited' | 'active' | 'suspended' | 'disabled';

export type BusinessUnitRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type UserRow = {
  id: string;
  business_unit_id: string | null;
  email: string;
  full_name: string;
  job_title: string | null;
  status: UserStatus;
  sessions_valid_from: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UserRoleRow = {
  user_id: string;
  role_code: RoleCode;
  granted_by: string | null;
  granted_at: string;
}

export type CandidateRow = {
  id: string;
  business_unit_id: string;
  reference: string;
  user_id: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  primary_skill: string | null;
  skills: string[];
  total_experience_months: number | null;
  current_location: string | null;
  visa_status: string | null;
  education: string | null;
  certifications: string[];
  preferred_locations: string[];
  marketing_status: MarketingStatus;
  primary_resume_document_id: string | null;
  archived_at: string | null;
  created_source: SourceKind;
  created_source_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CandidateAssignmentRow = {
  id: string;
  business_unit_id: string;
  candidate_id: string;
  user_id: string;
  assignment_type: AssignmentType;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  created_by: string | null;
  ended_by: string | null;
  created_at: string;
  updated_at: string;
}

export type MarketingPeriodRow = {
  id: string;
  business_unit_id: string;
  candidate_id: string;
  starts_on: string;
  ends_on: string | null;
  status: MarketingStatus;
  objective: string | null;
  opened_by: string | null;
  closed_by: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentRow = {
  id: string;
  business_unit_id: string;
  candidate_id: string;
  document_type: string;
  file_name: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  checksum_sha256: string | null;
  visibility: DocumentVisibility;
  version: number;
  supersedes_document_id: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DocumentTypeRow = {
  code: string;
  label: string;
  candidate_visible_default: boolean;
  is_active: boolean;
  sort_order: number;
}

export type CandidateInternalNoteRow = {
  id: string;
  business_unit_id: string;
  candidate_id: string;
  body: string;
  pinned: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ApplicationRow = {
  id: string;
  business_unit_id: string;
  candidate_id: string;
  marketing_period_id: string | null;
  company_name: string;
  position_title: string;
  job_id: string | null;
  job_url: string | null;
  job_location: string | null;
  application_date: string;
  status: ApplicationStatus;
  notes: string | null;
  source_type: SourceKind;
  source_reference: string | null;
  verified_at: string | null;
  verified_by: string | null;
  is_verified: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ApplicationStatusHistoryRow = {
  id: string;
  application_id: string;
  from_status: ApplicationStatus | null;
  to_status: ApplicationStatus;
  changed_at: string;
  changed_by: string | null;
  source_type: SourceKind;
  source_reference: string | null;
  note: string | null;
};

export type MarketingActivityRow = {
  id: string;
  business_unit_id: string;
  candidate_id: string;
  application_id: string | null;
  marketing_period_id: string | null;
  activity_type: ActivityType;
  activity_date: string;
  summary: string | null;
  details: Record<string, unknown>;
  source_type: SourceKind;
  source_reference: string | null;
  verified_at: string | null;
  verified_by: string | null;
  is_verified: boolean;
  visibility: DocumentVisibility;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Row shape returned by public.candidate_counts(uuid[]). */
export type CandidateCountsRow = {
  candidate_id: string;
  applications: number;
  recruiter_responses: number;
  interviews: number;
  assessments: number;
  rejections: number;
  offers: number;
};

/** Row shape returned by public.candidate_timeline(uuid). */
export type CandidateTimelineRow = {
  occurred_at: string;
  entry_kind: string;
  entry_id: string;
  title: string | null;
  detail: string | null;
  company_name: string | null;
  application_id: string | null;
  status: string | null;
  source_type: SourceKind;
  is_verified: boolean;
  actor_name: string | null;
};

export type InterviewRow = {
  id: string;
  business_unit_id: string;
  candidate_id: string;
  application_id: string;
  interview_round: number;
  scheduled_at: string | null;
  time_zone: string | null;
  meeting_url: string | null;
  interviewer_name: string | null;
  interviewer_email: string | null;
  status: InterviewStatus;
  notes: string | null;
  source_type: SourceKind;
  source_reference: string | null;
  verified_at: string | null;
  verified_by: string | null;
  is_verified: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InterviewScheduleHistoryRow = {
  id: string;
  interview_id: string;
  change_kind: string;
  previous_scheduled_at: string | null;
  previous_time_zone: string | null;
  previous_status: InterviewStatus | null;
  new_scheduled_at: string | null;
  new_time_zone: string | null;
  new_status: InterviewStatus | null;
  reason: string | null;
  changed_at: string;
  changed_by: string | null;
  source_type: SourceKind;
  source_reference: string | null;
};

export type AssessmentRow = {
  id: string;
  business_unit_id: string;
  candidate_id: string;
  application_id: string;
  assessment_type: string;
  assessment_url: string | null;
  received_at: string;
  deadline: string | null;
  completed_at: string | null;
  status: AssessmentStatus;
  outcome: string | null;
  notes: string | null;
  source_type: SourceKind;
  source_reference: string | null;
  verified_at: string | null;
  verified_by: string | null;
  is_verified: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type NotificationRow = {
  id: string;
  business_unit_id: string;
  recipient_id: string;
  notification_type: NotificationType;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  dedupe_key: string;
  read_at: string | null;
  created_at: string;
};

export type RolePermissionRow = {
  role_code: RoleCode;
  permission_code: string;
}

type TableDef<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      business_units: TableDef<BusinessUnitRow>;
      users: TableDef<UserRow>;
      user_roles: TableDef<UserRoleRow>;
      role_permissions: TableDef<RolePermissionRow>;
      candidates: TableDef<CandidateRow>;
      candidate_assignments: TableDef<CandidateAssignmentRow>;
      candidate_internal_notes: TableDef<CandidateInternalNoteRow>;
      marketing_periods: TableDef<MarketingPeriodRow>;
      documents: TableDef<DocumentRow>;
      document_types: TableDef<DocumentTypeRow>;
      applications: TableDef<ApplicationRow>;
      application_status_history: TableDef<ApplicationStatusHistoryRow>;
      marketing_activities: TableDef<MarketingActivityRow>;
      interviews: TableDef<InterviewRow>;
      interview_schedule_history: TableDef<InterviewScheduleHistoryRow>;
      assessments: TableDef<AssessmentRow>;
      notifications: TableDef<NotificationRow>;
    };
    Views: { [_ in never]: never };
    Functions: {
      reschedule_interview: {
        Args: {
          p_interview_id: string;
          p_scheduled_at: string;
          p_time_zone?: string | null;
          p_reason?: string | null;
        };
        Returns: string;
      };
      change_application_status: {
        Args: { p_application_id: string; p_status: ApplicationStatus; p_note?: string | null };
        Returns: ApplicationStatus;
      };
      candidate_counts: {
        Args: { p_candidate_ids: string[] };
        Returns: CandidateCountsRow[];
      };
      candidate_timeline: {
        Args: { p_candidate_id: string };
        Returns: CandidateTimelineRow[];
      };
      record_audit_event: {
        Args: {
          p_action: string;
          p_entity_type: string;
          p_entity_id?: string | null;
          p_metadata?: Record<string, unknown>;
        };
        Returns: undefined;
      };
    };
    Enums: {
      marketing_status: MarketingStatus;
      application_status: ApplicationStatus;
      activity_type: ActivityType;
      interview_status: InterviewStatus;
      assessment_status: AssessmentStatus;
      notification_type: NotificationType;
      assignment_type: AssignmentType;
      document_visibility: DocumentVisibility;
      user_status: UserStatus;
      source_kind: SourceKind;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
