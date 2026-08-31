-- ===========================================================================
-- 0024 — Daily reports and the review queue
--
-- THE RULE THIS FILE ENCODES
--
-- A daily report is a RECONCILIATION SNAPSHOT, not a source of truth. Its
-- numbers are derived from the underlying records every time they are read. A
-- recruiter who submitted 80 applications on 31 August does not type 80; the
-- system counts 80 application rows.
--
-- Confirming a report freezes a copy of those numbers so the reconciliation is
-- historically recoverable, and touches no source record. The snapshot columns
-- are therefore prefixed `snapshot_` and are meaningless until confirmation.
--
-- What a recruiter DOES contribute is judgement: notes, observations, and any
-- discrepancy they can see that the records cannot show. Those are separate
-- columns, and the UI keeps the distinction visible.
-- ===========================================================================

create type daily_report_status as enum ('draft', 'confirmed');

-- Neutral by design. A review item says something needs a person to look at
-- it, never that anyone did anything wrong.
create type review_item_type as enum (
  'incomplete_record',
  'possible_duplicate',
  'uncertain_activity',
  'missing_information',
  'ambiguous_source',
  'failed_automation',
  'conflicting_information'
);

create type review_item_status as enum ('open', 'in_review', 'resolved', 'dismissed');
create type review_item_priority as enum ('low', 'normal', 'high');
create type review_resolution as enum ('corrected', 'confirmed_correct', 'merged', 'no_action_needed');

-- ---------------------------------------------------------------------------
-- Daily reports
-- ---------------------------------------------------------------------------
create table public.daily_reports (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),

  -- Whose day this describes. Not necessarily who confirms it.
  recruiter_id     uuid not null references public.users(id) on delete cascade,
  report_date      date not null,

  status           daily_report_status not null default 'draft',

  -- USER-ENTERED. Judgement the records cannot supply.
  notes            text,
  observations     text,
  exceptions       text,

  -- SYSTEM-CALCULATED, frozen at confirmation. Null while a report is a draft,
  -- because a draft's numbers are whatever the records currently say.
  snapshot_applications        integer,
  snapshot_recruiter_responses integer,
  snapshot_interviews          integer,
  snapshot_assessments         integer,
  snapshot_rejections          integer,
  snapshot_taken_at            timestamptz,

  confirmed_by     uuid references public.users(id),
  confirmed_at     timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- One report per person per day. This is what makes confirmation idempotent.
  unique (recruiter_id, report_date),

  -- A confirmed report must carry its snapshot and its confirmer; a draft must
  -- carry neither. Enforced here so a half-confirmed row cannot exist.
  constraint daily_reports_confirmed_is_complete check (
    (status = 'draft'
      and confirmed_at is null and confirmed_by is null and snapshot_taken_at is null)
    or
    (status = 'confirmed'
      and confirmed_at is not null and confirmed_by is not null
      and snapshot_taken_at is not null
      and snapshot_applications is not null
      and snapshot_recruiter_responses is not null
      and snapshot_interviews is not null
      and snapshot_assessments is not null
      and snapshot_rejections is not null)
  ),

  constraint daily_reports_not_in_future check (report_date <= current_date)
);

create index daily_reports_recruiter_idx on public.daily_reports (recruiter_id, report_date desc);
create index daily_reports_unit_date_idx on public.daily_reports (business_unit_id, report_date desc);

create trigger set_updated_at before update on public.daily_reports
  for each row execute function util.tg_set_updated_at();

comment on column public.daily_reports.snapshot_applications is
  'SYSTEM-CALCULATED at confirmation. Live figures come from '
  'public.daily_report_metrics(); this column exists so a confirmed '
  'reconciliation stays recoverable if the underlying records later change.';

-- ---------------------------------------------------------------------------
-- Review queue
--
-- A review item is a piece of work: something a person needs to look at. It is
-- never an accusation, and the vocabulary above is deliberately neutral.
--
-- Items are never deleted. Resolving or dismissing one sets a status and a
-- resolution; the row and its history remain.
-- ---------------------------------------------------------------------------
create table public.review_items (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),

  item_type        review_item_type not null,
  priority         review_item_priority not null default 'normal',
  status           review_item_status not null default 'open',

  candidate_id     uuid references public.candidates(id) on delete cascade,

  -- Explicit nullable foreign keys rather than a polymorphic pair: polymorphic
  -- references cannot be foreign-keyed and rot silently.
  application_id   uuid references public.applications(id) on delete cascade,
  activity_id      uuid references public.marketing_activities(id) on delete cascade,
  interview_id     uuid references public.interviews(id) on delete cascade,
  assessment_id    uuid references public.assessments(id) on delete cascade,

  reason           text not null check (length(btrim(reason)) > 0),
  detail           text,

  -- Where the item came from. Reuses the existing provenance vocabulary, so a
  -- future email pipeline raising review items needs no new type.
  source_type      source_kind not null default 'system',
  source_reference text,

  -- Describes the FINDING, so re-running the checks converges instead of
  -- piling up duplicates. Same mechanism as notification dedupe.
  dedupe_key       text not null,

  assigned_to      uuid references public.users(id) on delete set null,

  resolution       review_resolution,
  resolution_notes text,
  resolved_by      uuid references public.users(id),
  resolved_at      timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- The idempotency guarantee for automated checks.
  unique (business_unit_id, dedupe_key),

  constraint review_items_closed_is_complete check (
    (status in ('open', 'in_review')
      and resolved_at is null and resolved_by is null and resolution is null)
    or
    (status in ('resolved', 'dismissed')
      and resolved_at is not null and resolved_by is not null and resolution is not null)
  )
);

create index review_items_queue_idx
  on public.review_items (business_unit_id, status, priority desc, created_at);
create index review_items_candidate_idx on public.review_items (candidate_id);
create index review_items_assignee_idx
  on public.review_items (assigned_to) where status in ('open', 'in_review');

create trigger set_updated_at before update on public.review_items
  for each row execute function util.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit, using the existing infrastructure unchanged.
-- ---------------------------------------------------------------------------
create trigger audit_rows after insert or update or delete on public.daily_reports
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.review_items
  for each row execute function audit.tg_audit_row();
