# 02 — Database Schema

PostgreSQL 15+ via Supabase. All DDL below is a **proposal sketch**, not a migration.
Types, constraints and indexes are real recommendations; column *lists* on the
profile-shaped tables are deliberately thin until we have mapped the actual Excel columns
(see [13 — Excel Migration](./13-excel-migration.md)).

## 0. Schema layout

| Schema | Contents | Exposed to PostgREST |
|---|---|---|
| `public` | All business tables and candidate-safe views | Yes |
| `ingest` | Email sources and machine interpretations | **No** |
| `staging` | Excel import batches and raw rows | **No** |
| `audit` | Immutable audit log | **No** |
| `util` | SECURITY DEFINER helper functions | **No** |

Non-exposed schemas are reachable only from server-side code holding the service role, or
from `SECURITY DEFINER` functions. This gives the source/interpretation layers a physical
boundary, not just a naming convention.

```sql
create schema if not exists ingest;
create schema if not exists staging;
create schema if not exists audit;
create schema if not exists util;

-- Do not add these to Supabase's exposed schema list.
revoke all on schema ingest, staging, audit, util from anon, authenticated;
```

Extensions: `pgcrypto` (UUIDv4/v7), `citext` (case-insensitive email), `btree_gist`
(exclusion constraints on date ranges), `pg_trgm` (fuzzy name search for identity matching).

## 1. Conventions

- **Primary keys:** `uuid` defaulting to `gen_random_uuid()`. Rationale: records are created
  from multiple contexts (UI, import, future ingestion worker) and ID generation must not
  require a round trip. Bigserial is used only for `audit.audit_logs`, which is
  insert-ordered and never referenced by FK.
- **Timestamps:** `timestamptz` always. `date` only for genuinely date-only business facts
  (`report_date`, `marketing_periods.starts_on`).
- **Naming:** plural snake_case tables, `<table>_id` FKs, `_at` for timestamps, `_on` for
  dates, `is_` for booleans.
- **Every business table carries:** `created_at`, `updated_at`, `created_by`, `updated_by`.
- **Enumerations:** Postgres `enum` types for closed, stable sets that the code branches on
  (statuses). Lookup **tables** for anything the business may want to extend without a
  migration (rejection reason categories, activity types, document types). Getting this
  split wrong is a common source of migration pain, so the rule is: *if a non-engineer might
  reasonably want to add a value, it is a table.*
- **Soft delete:** `archived_at` on candidate-scale entities only. Pipeline records are never
  deleted; they get a terminal status. Hard `DELETE` is reserved for admin correction and is
  audited with the full old row.
- **`updated_at`** maintained by a single shared trigger `util.tg_set_updated_at()`.

> DDL below is grouped by domain for reading, not by dependency order. A few forward
> references (`marketing_activities` → `applications`, `interviews`) resolve in the real
> migrations, which create tables first and add the cross-domain foreign keys afterwards.

## 1a. Enumerated types

Declared once, up front. Values marked *provisional* are placeholders pending **D-05**.

```sql
-- provenance: the same vocabulary is used by every record, event and provenance row
create type source_kind as enum
  ('manual','excel_import','email_event','system','api');

create type candidate_status        as enum ('prospect','onboarding','active','on_hold','placed','inactive','archived');           -- provisional
create type marketing_period_status as enum ('planned','active','paused','completed','stopped');
create type application_status      as enum ('submitted','acknowledged','in_review','interviewing','assessment','offer','rejected','withdrawn','closed'); -- provisional
create type work_mode               as enum ('onsite','hybrid','remote','unknown');
create type org_kind                as enum ('client','vendor','implementation_partner','staffing_agency','unknown');
create type recruiter_response_type as enum ('interest','screening_request','information_request','rejection','other');
create type interview_type          as enum ('screening','technical','managerial','client','hr','other');
create type interview_mode          as enum ('phone','video','onsite','unknown');
create type interview_status        as enum ('scheduled','rescheduled','cancelled','completed','no_show');
create type interview_outcome       as enum ('passed','failed','pending','unknown');
create type assessment_status       as enum ('assigned','in_progress','submitted','completed','expired','cancelled');
create type assessment_result       as enum ('passed','failed','pending','unknown');
create type rejection_stage         as enum ('submission','screening','interview','assessment','offer','unknown');
create type offer_status            as enum ('received','under_review','accepted','declined','withdrawn','expired');
create type daily_report_status     as enum ('draft','submitted','locked');
create type document_visibility     as enum ('internal','candidate_visible');
create type review_item_type        as enum ('low_confidence_classification','ambiguous_identity','possible_duplicate','conflicting_data','unlinked_record','import_anomaly','manual');
create type review_severity         as enum ('low','normal','high');
create type review_status           as enum ('open','in_progress','resolved','dismissed');
create type review_resolution       as enum ('accepted','rejected','merged','ignored','superseded');
create type email_event_type        as enum ('application_detected','response_detected','interview_detected','interview_rescheduled','interview_cancelled','assessment_detected','rejection_detected','offer_detected','identity_matched','vendor_identified','duplicate_suspected','inconsistency_detected','unclassified');
create type email_event_status      as enum ('proposed','needs_review','applied','rejected','superseded');
```

Widening an enum is `alter type ... add value`, which is cheap and non-blocking. *Removing* or
renaming a value is not, which is why the enum/lookup-table split in the conventions above
matters and why **D-05** should be answered before Stage 2.

## 2. Identity & access

```sql
-- Mirror of auth.users; the app never joins to auth.users directly.
create table public.users (
  id            uuid primary key references auth.users(id) on delete restrict,
  email         citext not null unique,
  full_name     text not null,
  job_title     text,
  avatar_path   text,
  status        text not null default 'active'
                  check (status in ('invited','active','suspended','disabled')),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.roles (
  code         text primary key
                 check (code in ('admin','manager','recruiter','candidate')),
  name         text not null,
  description  text,
  rank         smallint not null            -- ordering only, NOT an inheritance mechanism
);

create table public.user_roles (
  user_id     uuid not null references public.users(id) on delete cascade,
  role_code   text not null references public.roles(code),
  granted_by  uuid references public.users(id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, role_code)
);

create table public.permissions (
  code        text primary key,             -- e.g. 'candidate.write', 'report.view_all'
  domain      text not null,
  description text not null
);

create table public.role_permissions (
  role_code        text not null references public.roles(code) on delete cascade,
  permission_code  text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);
```

**Why `role_permissions` is a table and not a hardcoded matrix.** The brief says MANAGER
manages things "according to permissions," which implies the manager's reach is tunable. A
table lets that be tuned without a deploy, and lets application code check *capabilities*
(`can('application.delete')`) rather than roles — so widening a role later touches one seed
row instead of forty call sites. The cost is one extra join, mitigated by embedding the
resolved permission set in the JWT (see doc 03).

**Constraint: the candidate role is exclusive.** A user is either internal or a candidate,
never both. Enforced by trigger, not convention:

```sql
create or replace function util.tg_enforce_exclusive_candidate_role()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.user_id
      and (ur.role_code = 'candidate') <> (new.role_code = 'candidate')
  ) then
    raise exception 'candidate role cannot be combined with internal roles (user %)', new.user_id;
  end if;
  return new;
end $$;
```

## 3. Candidate

```sql
create table public.candidates (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,        -- human key, e.g. 'MDX-00142'
  user_id        uuid unique references public.users(id) on delete set null,
                 -- null until the candidate is invited to the portal
  first_name     text not null,
  last_name      text not null,
  full_name      text generated always as (first_name || ' ' || last_name) stored,
  primary_email  citext not null,
  phone          text,
  status         candidate_status not null default 'prospect',
  city           text,
  state          text,
  country        text,
  time_zone      text,
  archived_at    timestamptz,
  created_source source_kind not null default 'manual',
  created_source_id uuid,
  created_by     uuid references public.users(id),
  updated_by     uuid references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index candidates_primary_email_active_uk
  on public.candidates (primary_email) where archived_at is null;
create index candidates_full_name_trgm on public.candidates using gin (full_name gin_trgm_ops);
```

`candidate_status` values are **[DECISION NEEDED]** (doc 15, D-05) — they must come from your
current spreadsheet, not from me. Placeholder set for discussion:
`prospect | onboarding | active | on_hold | placed | inactive | archived`.

```sql
create table public.candidate_profiles (
  candidate_id            uuid primary key references public.candidates(id) on delete cascade,
  headline                text,
  summary                 text,
  total_experience_months integer check (total_experience_months >= 0),
  primary_skill           text,
  skills                  text[] not null default '{}',
  available_from          date,
  willing_to_relocate     boolean,
  preferred_locations     text[] not null default '{}',
  linkedin_url            text,
  updated_by              uuid references public.users(id),
  updated_at              timestamptz not null default now()
);
```

Work authorization, visa status, rate expectations and similar fields are **intentionally
absent** pending the column mapping exercise — they are legally and commercially sensitive and
I will not invent them. See doc 15, D-06.

```sql
create table public.candidate_assignments (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references public.candidates(id) on delete cascade,
  user_id        uuid not null references public.users(id) on delete restrict,
  is_primary     boolean not null default false,
  assigned_by    uuid references public.users(id),
  assigned_at    timestamptz not null default now(),
  unassigned_at  timestamptz,
  unassigned_by  uuid references public.users(id),
  check (unassigned_at is null or unassigned_at >= assigned_at)
);

-- one active primary owner per candidate
create unique index candidate_assignments_one_primary_uk
  on public.candidate_assignments (candidate_id)
  where is_primary and unassigned_at is null;

-- a user is not assigned to the same candidate twice concurrently
create unique index candidate_assignments_active_uk
  on public.candidate_assignments (candidate_id, user_id)
  where unassigned_at is null;

create index candidate_assignments_by_user
  on public.candidate_assignments (user_id) where unassigned_at is null;
```

That last index is load-bearing: every recruiter RLS check reads it.

```sql
create table public.candidate_internal_notes (
  id           uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  body         text not null,
  pinned       boolean not null default false,
  created_by   uuid not null references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Same pattern for pipeline commentary. Defined here rather than next to `applications`
-- to keep the "internal notes are never columns" rule visible in one place.
create table public.application_internal_notes (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  candidate_id   uuid not null references public.candidates(id) on delete cascade,
  body           text not null,
  created_by     uuid not null references public.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

`candidate_id` is carried on `application_internal_notes` so the RLS predicate is the same
single `util.can_access_candidate(candidate_id)` call as every other table, with no join.

## 4. Marketing

```sql
create table public.marketing_periods (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references public.candidates(id) on delete cascade,
  starts_on     date not null,
  ends_on       date,
  status        marketing_period_status not null default 'planned',
                -- planned | active | paused | completed | stopped
  objective     text,
  opened_by     uuid references public.users(id),
  closed_by     uuid references public.users(id),
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  unique (id, candidate_id)          -- supports the composite FK from applications
);

-- No two overlapping non-terminal periods for the same candidate.
-- [DECISION NEEDED, D-07] — remove this if concurrent parallel marketing tracks are legitimate.
alter table public.marketing_periods
  add constraint marketing_periods_no_overlap
  exclude using gist (
    candidate_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') with &&
  ) where (status in ('planned','active','paused'));
```

```sql
create table public.marketing_activity_types (       -- lookup, business-extensible
  code text primary key, label text not null, is_active boolean not null default true,
  sort_order smallint not null default 0
);
-- seed: call, email_sent, submission, follow_up, profile_update, note, other

create table public.marketing_activities (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid not null references public.candidates(id) on delete cascade,
  marketing_period_id  uuid references public.marketing_periods(id) on delete set null,
  activity_type        text not null references public.marketing_activity_types(code),
  occurred_at          timestamptz not null default now(),
  subject              text,
  details              text,
  application_id       uuid references public.applications(id) on delete set null,
  interview_id         uuid references public.interviews(id) on delete set null,
  performed_by         uuid references public.users(id),
  created_source       source_kind not null default 'manual',
  created_source_id    uuid,
  created_at           timestamptz not null default now()
);

create index marketing_activities_candidate_time
  on public.marketing_activities (candidate_id, occurred_at desc);
```

Related records are referenced by **explicit nullable FKs**, not a polymorphic
`(entity_type, entity_id)` pair. Polymorphic references cannot be foreign-keyed, cannot be
indexed usefully for joins, and rot silently. The cost is a few extra nullable columns, which
is the right trade.

## 5. Pipeline records

```sql
create table public.organizations (               -- [PROPOSED ADDITION]
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  kind        org_kind not null default 'unknown',
                -- client | vendor | implementation_partner | staffing_agency | unknown
  domains     citext[] not null default '{}',     -- used later for email-sender matching
  is_flagged  boolean not null default false,     -- e.g. known problematic third party
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index organizations_normalized_name_uk on public.organizations (normalized_name);

create table public.organization_contacts (       -- [PROPOSED ADDITION]
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete set null,
  full_name        text,
  email            citext,
  phone            text,
  created_at       timestamptz not null default now()
);
create unique index organization_contacts_email_uk on public.organization_contacts (email)
  where email is not null;
```

```sql
create table public.applications (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid not null references public.candidates(id) on delete cascade,
  marketing_period_id  uuid not null,
  job_title            text not null,
  client_organization_id uuid references public.organizations(id),
  vendor_organization_id uuid references public.organizations(id),
  client_name_raw      text,             -- always kept; the FK is an enrichment, not a gate
  vendor_name_raw      text,
  job_location         text,
  work_mode            work_mode,        -- onsite | hybrid | remote | unknown
  job_reference        text,             -- vendor's requisition id, when known
  status               application_status not null default 'submitted',
  applied_at           timestamptz not null default now(),
  closed_at            timestamptz,
  submitted_by         uuid references public.users(id),
  created_source       source_kind not null default 'manual',
  created_source_id    uuid,
  created_by           uuid references public.users(id),
  updated_by           uuid references public.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (marketing_period_id, candidate_id)
    references public.marketing_periods(id, candidate_id)   -- cannot drift
);

create index applications_candidate_applied on public.applications (candidate_id, applied_at desc);
create index applications_status_open on public.applications (status) where closed_at is null;
create index applications_period on public.applications (marketing_period_id);
```

`application_status` placeholder — **[DECISION NEEDED, D-05]**, must be derived from your
spreadsheet's real stages:
`submitted | acknowledged | in_review | interviewing | assessment | offer | rejected | withdrawn | closed`

```sql
create table public.application_status_history (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications(id) on delete cascade,
  from_status     application_status,
  to_status       application_status not null,
  changed_at      timestamptz not null default now(),
  changed_by      uuid references public.users(id),
  source          source_kind not null default 'manual',
  source_id       uuid,
  note            text
);
create index application_status_history_app on public.application_status_history (application_id, changed_at);
```

Append-only: `revoke update, delete on public.application_status_history from authenticated;`

```sql
create table public.recruiter_responses (
  id               uuid primary key default gen_random_uuid(),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  application_id   uuid references public.applications(id) on delete set null,
  responder_contact_id uuid references public.organization_contacts(id),
  responder_name   text,
  responder_email  citext,
  organization_id  uuid references public.organizations(id),
  received_at      timestamptz not null,
  response_type    recruiter_response_type not null default 'other',
                   -- interest | screening_request | information_request | rejection | other
  summary          text,
  created_source   source_kind not null default 'manual',
  created_source_id uuid,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now()
);
create index recruiter_responses_candidate on public.recruiter_responses (candidate_id, received_at desc);
```

```sql
create table public.interviews (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references public.candidates(id) on delete cascade,
  application_id    uuid references public.applications(id) on delete set null,
  round_number      smallint not null default 1 check (round_number > 0),
  interview_type    interview_type not null default 'other',
                    -- screening | technical | managerial | client | hr | other
  mode              interview_mode not null default 'unknown',   -- phone | video | onsite | unknown
  scheduled_start   timestamptz,
  scheduled_end     timestamptz,
  time_zone         text,
  location_or_link  text,
  panel             text,
  status            interview_status not null default 'scheduled',
                    -- scheduled | rescheduled | cancelled | completed | no_show
  outcome           interview_outcome,          -- passed | failed | pending | unknown (null until known)
  feedback_summary  text,
  created_source    source_kind not null default 'manual',
  created_source_id uuid,
  created_by        uuid references public.users(id),
  updated_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start)
);
create index interviews_candidate_time on public.interviews (candidate_id, scheduled_start desc);
create index interviews_upcoming on public.interviews (scheduled_start)
  where status in ('scheduled','rescheduled');

create table public.interview_schedule_history (   -- append-only
  id                 uuid primary key default gen_random_uuid(),
  interview_id       uuid not null references public.interviews(id) on delete cascade,
  previous_start     timestamptz,
  previous_end       timestamptz,
  new_start          timestamptz,
  new_end            timestamptz,
  change_kind        text not null check (change_kind in ('scheduled','rescheduled','cancelled')),
  reason             text,
  changed_at         timestamptz not null default now(),
  changed_by         uuid references public.users(id),
  source             source_kind not null default 'manual'
);
```

Reschedules and cancellations are first-class because email intelligence is explicitly
required to detect them, and because "how often do this vendor's interviews get moved" is a
question the business will eventually ask.

```sql
create table public.assessment_types (   -- lookup, business-extensible
  code text primary key, label text not null, is_active boolean not null default true
);
-- seed: coding, aptitude, domain, video_interview, take_home, other

create table public.assessments (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references public.candidates(id) on delete cascade,
  application_id    uuid references public.applications(id) on delete set null,
  assessment_type   text not null references public.assessment_types(code),
  platform          text,
  assigned_at       timestamptz,
  due_at            timestamptz,
  submitted_at      timestamptz,
  status            assessment_status not null default 'assigned',
                    -- assigned | in_progress | submitted | completed | expired | cancelled
  score             numeric(6,2),
  max_score         numeric(6,2),
  result            assessment_result,     -- passed | failed | pending | unknown
  notes             text,
  created_source    source_kind not null default 'manual',
  created_source_id uuid,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (max_score is null or score is null or score <= max_score)
);
create index assessments_due on public.assessments (due_at)
  where status in ('assigned','in_progress');
```

```sql
create table public.rejection_reasons (   -- lookup, business-extensible
  code text primary key, label text not null, is_active boolean not null default true
);

create table public.rejections (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references public.candidates(id) on delete cascade,
  application_id    uuid references public.applications(id) on delete set null,
  interview_id      uuid references public.interviews(id) on delete set null,
  stage             rejection_stage not null default 'unknown',
                    -- submission | screening | interview | assessment | offer | unknown
  reason_code       text references public.rejection_reasons(code),
  reason_text       text,
  rejected_at       timestamptz not null,
  created_source    source_kind not null default 'manual',
  created_source_id uuid,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now()
);

create table public.offers (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references public.candidates(id) on delete cascade,
  application_id    uuid references public.applications(id) on delete set null,
  organization_id   uuid references public.organizations(id),
  role_title        text,
  offered_at        timestamptz not null,
  expires_at        timestamptz,
  expected_start_on date,
  status            offer_status not null default 'received',
                    -- received | under_review | accepted | declined | withdrawn | expired
  compensation_note text,        -- structured comp is [DECISION NEEDED, D-08]
  decided_at        timestamptz,
  decided_by        uuid references public.users(id),
  created_source    source_kind not null default 'manual',
  created_source_id uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
```

## 6. Daily reports

```sql
create table public.daily_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete restrict,
  report_date  date not null,
  status       daily_report_status not null default 'draft',  -- draft | submitted | locked
  summary      text,
  blockers     text,
  submitted_at timestamptz,
  locked_at    timestamptz,
  reviewed_by  uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, report_date)
);

create table public.daily_report_entries (
  id                uuid primary key default gen_random_uuid(),
  daily_report_id   uuid not null references public.daily_reports(id) on delete cascade,
  candidate_id      uuid not null references public.candidates(id) on delete restrict,

  -- computed from verified records at submission time
  system_applications  integer not null default 0,
  system_responses     integer not null default 0,
  system_interviews    integer not null default 0,

  -- what the recruiter asserts, if it differs
  reported_applications integer,
  reported_responses    integer,
  reported_interviews   integer,
  is_overridden         boolean generated always as (
    reported_applications is not null or reported_responses is not null
      or reported_interviews is not null) stored,
  override_reason       text,

  notes             text,
  created_at        timestamptz not null default now(),
  unique (daily_report_id, candidate_id)
);
```

**Why two sets of counts.** A daily report that is purely manual re-creates the spreadsheet's
core defect: numbers that disagree with the records and no way to tell which is right. A
report that is purely derived cannot capture work the system does not yet track. Storing
both, with an explicit override reason, is the same source/interpretation/verified split
applied to reporting — and it makes "which recruiters' reports diverge from their records"
an answerable question on day one.

## 7. Documents

```sql
create table public.document_types (   -- lookup
  code text primary key, label text not null, candidate_visible_default boolean not null default false
);
-- seed: resume, formatted_resume, cover_letter, certification, id_proof, offer_letter, assessment_brief, other

create table public.documents (
  id                    uuid primary key default gen_random_uuid(),
  candidate_id          uuid references public.candidates(id) on delete cascade,
  application_id        uuid references public.applications(id) on delete set null,
  document_type         text not null references public.document_types(code),
  storage_bucket        text not null default 'candidate-documents',
  storage_path          text not null unique,
  file_name             text not null,
  mime_type             text not null,
  size_bytes            bigint not null check (size_bytes > 0),
  checksum_sha256       text not null,
  visibility            document_visibility not null default 'internal',
                        -- internal | candidate_visible
  version               integer not null default 1,
  supersedes_document_id uuid references public.documents(id),
  uploaded_by           uuid references public.users(id),
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  check (candidate_id is not null or application_id is not null)
);
create index documents_candidate on public.documents (candidate_id) where deleted_at is null;
create unique index documents_checksum_per_candidate
  on public.documents (candidate_id, checksum_sha256) where deleted_at is null;
```

Storage path convention, which the Storage RLS policies parse:
`candidate-documents/{candidate_id}/{document_type}/{uuid}-{filename}`

## 8. Review items & provenance

```sql
create table public.review_items (
  id            uuid primary key default gen_random_uuid(),
  item_type     review_item_type not null,
                -- low_confidence_classification | ambiguous_identity | possible_duplicate
                -- | conflicting_data | unlinked_record | import_anomaly | manual
  severity      review_severity not null default 'normal',   -- low | normal | high
  status        review_status not null default 'open',       -- open | in_progress | resolved | dismissed
  title         text not null,
  detail        text,
  candidate_id  uuid references public.candidates(id) on delete cascade,
  source_type   source_kind not null,      -- email_event | excel_import | system_check | manual
  source_id     uuid,
  payload       jsonb not null default '{}'::jsonb,   -- the proposal being reviewed
  assigned_to   uuid references public.users(id),
  due_at        timestamptz,
  resolution    review_resolution,          -- accepted | rejected | merged | ignored | superseded
  resolution_note text,
  resolved_by   uuid references public.users(id),
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index review_items_queue on public.review_items (status, severity desc, created_at)
  where status in ('open','in_progress');
create index review_items_candidate on public.review_items (candidate_id);
```

```sql
create table public.record_provenance (
  id           uuid primary key default gen_random_uuid(),
  record_table text not null,          -- 'applications', 'interviews', ...
  record_id    uuid not null,
  field_name   text,                   -- null = whole-record provenance
  source_kind  source_kind not null,   -- manual | excel_import | email_event | api | system
  source_id    uuid,
  confidence   numeric(4,3) check (confidence between 0 and 1),
  actor_id     uuid references public.users(id),
  created_at   timestamptz not null default now()
);
create index record_provenance_record on public.record_provenance (record_table, record_id);
```

This is what makes "never silently overwrite historical facts" enforceable rather than
aspirational: for any field on any record we can answer *who or what asserted this, from
which source, with what confidence.*

## 9. Ingest schema (created in V1, populated later)

```sql
create table ingest.mailboxes (
  id uuid primary key default gen_random_uuid(),
  address citext not null unique,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- STRICTLY APPEND-ONLY. No UPDATE, no DELETE, ever.
create table ingest.emails (
  id             uuid primary key default gen_random_uuid(),
  mailbox_id     uuid not null references ingest.mailboxes(id),
  message_id     text not null,          -- RFC 5322 Message-ID
  thread_id      text,
  in_reply_to    text,
  from_email     citext not null,
  from_name      text,
  to_addresses   jsonb not null default '[]'::jsonb,
  cc_addresses   jsonb not null default '[]'::jsonb,
  subject        text,
  sent_at        timestamptz,
  received_at    timestamptz not null,
  body_text      text,
  raw_storage_path text not null,        -- original .eml in a private bucket
  checksum_sha256 text not null,
  ingested_at    timestamptz not null default now(),
  unique (mailbox_id, message_id)
);

-- Mutable processing state kept OUT of the immutable table.
create table ingest.email_processing_state (
  email_id    uuid primary key references ingest.emails(id) on delete cascade,
  state       text not null default 'received',
              -- received | parsed | classified | linked | reviewed | failed | ignored
  attempts    smallint not null default 0,
  last_error  text,
  pipeline_version text,
  updated_at  timestamptz not null default now()
);

create table ingest.email_attachments (
  id uuid primary key default gen_random_uuid(),
  email_id uuid not null references ingest.emails(id) on delete cascade,
  file_name text, mime_type text, size_bytes bigint,
  storage_path text not null, checksum_sha256 text
);

-- INTERPRETATION LAYER. Never authoritative.
create table ingest.email_events (
  id              uuid primary key default gen_random_uuid(),
  email_id        uuid not null references ingest.emails(id) on delete cascade,
  event_type      email_event_type not null,
  candidate_id    uuid references public.candidates(id) on delete set null,  -- proposed match
  confidence      numeric(4,3) not null check (confidence between 0 and 1),
  extracted       jsonb not null default '{}'::jsonb,
  classifier      text not null,          -- e.g. 'rules@1' or a model identifier
  pipeline_version text not null,
  status          email_event_status not null default 'proposed',
                  -- proposed | needs_review | applied | rejected | superseded
  applied_table   text,
  applied_record_id uuid,
  decided_by      uuid references public.users(id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index email_events_pending on ingest.email_events (status, confidence desc)
  where status in ('proposed','needs_review');
```

`email_event_type`: `application_detected | response_detected | interview_detected |
interview_rescheduled | interview_cancelled | assessment_detected | rejection_detected |
offer_detected | identity_matched | vendor_identified | duplicate_suspected | inconsistency_detected | unclassified`

## 10. Notifications

```sql
create table public.notification_types (
  code text primary key, label text not null, default_severity text not null default 'info'
);

create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid not null references public.users(id) on delete cascade,
  type_code      text not null references public.notification_types(code),
  severity       text not null default 'info' check (severity in ('info','success','warning','critical')),
  title          text not null,
  body           text,
  entity_table   text,
  entity_id      uuid,
  action_path    text,          -- app-relative link, never an absolute URL
  dedupe_key     text,
  actor_id       uuid references public.users(id),   -- null = system
  read_at        timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);
create unique index notifications_dedupe_uk on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null;
create index notifications_inbox on public.notifications (recipient_id, created_at desc)
  where read_at is null and archived_at is null;

create table public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel         text not null check (channel in ('in_app','email')),
  status          text not null default 'pending'
                    check (status in ('pending','sent','failed','skipped')),
  attempts        smallint not null default 0,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (notification_id, channel)
);
```

## 11. Staging schema

```sql
create table staging.import_batches (
  id             uuid primary key default gen_random_uuid(),
  source_file_name text not null,
  sheet_name     text,
  storage_path   text not null,
  checksum_sha256 text not null,
  mapping_version text not null,
  status         text not null default 'uploaded'
                   check (status in ('uploaded','parsed','validated','promoted','failed','rolled_back')),
  row_count      integer not null default 0,
  imported_by    uuid references public.users(id),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  notes          text
);

-- raw is immutable; normalized/status are the interpretation
create table staging.import_rows (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references staging.import_batches(id) on delete cascade,
  row_number     integer not null,
  raw            jsonb not null,
  normalized     jsonb,
  natural_key_hash text,               -- for idempotent re-runs
  status         text not null default 'pending'
                   check (status in ('pending','valid','promoted','duplicate','needs_review','rejected')),
  target_table   text,
  target_record_id uuid,
  issues         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  unique (batch_id, row_number)
);
create unique index import_rows_natural_key_uk
  on staging.import_rows (natural_key_hash) where status = 'promoted';
```

## 12. Audit schema

See [11 — Audit Logging](./11-audit-logging.md) for the full design including the generic
trigger and partitioning.

```sql
create table audit.audit_logs (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,
  actor_kind    text not null default 'user' check (actor_kind in ('user','system','service','anonymous')),
  actor_roles   text[],
  action        text not null,     -- insert | update | delete | login | export | grant | promote | ...
  table_schema  text,
  table_name    text,
  record_id     uuid,
  changed_fields text[],
  old_data      jsonb,
  new_data      jsonb,
  request_id    uuid,
  ip_address    inet,
  user_agent    text
) partition by range (occurred_at);
```

## 13. Candidate-safe views

`security_invoker` views project columns; RLS on the base tables still applies underneath.
Two independent layers, neither sufficient alone.

```sql
create view public.portal_applications with (security_invoker = true) as
select a.id, a.candidate_id, a.job_title,
       coalesce(o.name, a.client_name_raw) as company,
       a.job_location, a.work_mode, a.status, a.applied_at
from public.applications a
left join public.organizations o on o.id = a.client_organization_id;
-- deliberately omits: vendor, job_reference, submitted_by, source columns, internal ids
```

Companion views: `portal_interviews`, `portal_assessments`, `portal_offers`,
`portal_documents`, `portal_marketing_periods`, `portal_timeline`.

## 14. Timeline

```sql
create view public.v_candidate_timeline as
  select candidate_id, 'application'::text as event_kind, id as record_id,
         applied_at as occurred_at, job_title as title, status::text as detail
    from public.applications
  union all
  select candidate_id, 'interview', id, coalesce(scheduled_start, created_at),
         interview_type::text, status::text from public.interviews
  union all
  select candidate_id, 'assessment', id, coalesce(assigned_at, created_at),
         assessment_type, status::text from public.assessments
  union all
  select candidate_id, 'rejection', id, rejected_at, stage::text, reason_text
    from public.rejections
  union all
  select candidate_id, 'offer', id, offered_at, role_title, status::text
    from public.offers
  union all
  select candidate_id, 'activity', id, occurred_at, activity_type, subject
    from public.marketing_activities;
```

**A view, not a materialised table, for V1.** A derived table would need triggers on six
tables and would drift the first time someone backfills data. The view cannot drift. If
profiling shows it is too slow at scale, the migration to a materialised `timeline_events`
table is mechanical and can happen without changing any caller. Deferring is cheap here;
being wrong about consistency is not.
