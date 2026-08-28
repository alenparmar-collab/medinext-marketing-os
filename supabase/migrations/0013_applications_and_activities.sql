-- ===========================================================================
-- 0013 — Applications, status history and marketing activities
--
-- THE PRINCIPLE THIS FILE ENCODES (Build 3 brief):
--   Manual entry is temporary infrastructure. Email intelligence will later
--   create many of these records automatically. So every row must say, at the
--   moment it is written, WHERE it came from and WHETHER a human has vouched
--   for it — not have that reconstructed afterwards, which is impossible.
--
-- Hence source_type + source_reference + verified_at/verified_by on both
-- applications and activities.
--
-- We reuse the existing `source_kind` enum rather than introducing a second
-- vocabulary. It already distinguishes the four cases the brief names:
--     MANUAL -> 'manual'      SYSTEM -> 'system'
--     EMAIL  -> 'email_event' IMPORT -> 'excel_import'
-- Two competing source enums would be a lasting source of bugs.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- The controlled application status model, exactly as specified.
create type application_status as enum (
  'submitted',
  'recruiter_response',
  'screening',
  'interview',
  'assessment',
  'offer',
  'rejected',
  'withdrawn',
  'closed'
);

-- Chronological activity vocabulary. Code branches on these, and the set is
-- closed, so an enum rather than a lookup table. Widening later is
-- `alter type ... add value`, which is cheap and non-blocking.
create type activity_type as enum (
  'application_submitted',
  'recruiter_response',
  'interview',
  'assessment',
  'rejection',
  'offer',
  'follow_up',
  'note',
  'status_change'
);

-- ---------------------------------------------------------------------------
-- Applications
--
-- job_location is INFORMATION ABOUT THE JOB and nothing more. Nothing in this
-- schema, or anywhere in this codebase, compares it against a candidate's
-- current_location or preferred_locations. There is no mismatch rule.
-- ---------------------------------------------------------------------------
create table public.applications (
  id                  uuid primary key default gen_random_uuid(),
  business_unit_id    uuid not null references public.business_units(id),
  candidate_id        uuid not null references public.candidates(id) on delete cascade,

  -- Optional: an application can predate the period it belongs to being opened,
  -- and email-derived applications may arrive with no period context at all.
  marketing_period_id uuid references public.marketing_periods(id) on delete set null,

  company_name        text not null check (length(btrim(company_name)) > 0),
  position_title      text not null check (length(btrim(position_title)) > 0),
  job_id              text,
  job_url             text check (job_url is null or job_url ~* '^https?://'),
  job_location        text,

  application_date    date not null default current_date,
  status              application_status not null default 'submitted',
  notes               text,

  -- Provenance. Written at insert time; cannot be reconstructed later.
  source_type         source_kind not null default 'manual',
  source_reference    text,

  -- Human verification. A manually entered row is verified by the person who
  -- typed it; a future email-derived row arrives unverified until someone
  -- accepts it.
  verified_at         timestamptz,
  verified_by         uuid references public.users(id),
  is_verified         boolean generated always as (verified_at is not null) stored,

  created_by          uuid references public.users(id),
  updated_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  foreign key (candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id),
  foreign key (marketing_period_id, candidate_id)
    references public.marketing_periods (id, candidate_id),

  -- Lets activities point at (application, candidate) and be structurally
  -- unable to drift onto a different candidate.
  unique (id, candidate_id)
);

create index applications_candidate_idx
  on public.applications (candidate_id, application_date desc);
create index applications_status_idx
  on public.applications (business_unit_id, status);
create index applications_company_idx
  on public.applications (business_unit_id, lower(company_name));
create index applications_unverified_idx
  on public.applications (business_unit_id) where verified_at is null;

create trigger set_updated_at before update on public.applications
  for each row execute function util.tg_set_updated_at();

comment on column public.applications.job_location is
  'Descriptive only. Never compared against candidate location. No mismatch rule exists.';

-- ---------------------------------------------------------------------------
-- Status history — append-only.
--
-- The current `status` column is a queryable cache of the last row here. If the
-- two ever diverge, this table is the truth.
-- ---------------------------------------------------------------------------
create table public.application_status_history (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null references public.applications(id) on delete cascade,
  from_status      application_status,
  to_status        application_status not null,
  changed_at       timestamptz not null default now(),
  changed_by       uuid references public.users(id),
  source_type      source_kind not null default 'manual',
  source_reference text,
  note             text
);

create index application_status_history_app_idx
  on public.application_status_history (application_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Marketing activities — the chronological event model.
--
-- THIS IS THE AGGREGATION SOURCE. "Applications = 80" is answered by counting
-- application_submitted activities (or application rows), never by a number a
-- recruiter typed into a report. Daily reports, when they arrive, derive from
-- here rather than the other way round.
-- ---------------------------------------------------------------------------
create table public.marketing_activities (
  id                  uuid primary key default gen_random_uuid(),
  business_unit_id    uuid not null references public.business_units(id),
  candidate_id        uuid not null references public.candidates(id) on delete cascade,
  application_id      uuid references public.applications(id) on delete set null,
  marketing_period_id uuid references public.marketing_periods(id) on delete set null,

  activity_type       activity_type not null,
  activity_date       timestamptz not null default now(),
  summary             text,

  -- Typed payload per activity kind (interview round, assessment platform,
  -- rejection reason). jsonb rather than columns because the shape differs per
  -- type and later builds add dedicated tables for the ones that earn them.
  details             jsonb not null default '{}'::jsonb,

  -- Provenance, as above.
  source_type         source_kind not null default 'manual',
  source_reference    text,

  verified_at         timestamptz,
  verified_by         uuid references public.users(id),
  is_verified         boolean generated always as (verified_at is not null) stored,

  -- Whether the candidate may see this in their portal timeline.
  -- Defaulted from the activity type by trigger below, so an internal note can
  -- never reach a candidate through an omission at the call site.
  visibility          document_visibility not null default 'internal',

  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  foreign key (candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id),
  foreign key (application_id, candidate_id)
    references public.applications (id, candidate_id)
);

create index marketing_activities_candidate_idx
  on public.marketing_activities (candidate_id, activity_date desc);
create index marketing_activities_application_idx
  on public.marketing_activities (application_id) where application_id is not null;
create index marketing_activities_type_idx
  on public.marketing_activities (business_unit_id, activity_type, activity_date desc);
create index marketing_activities_portal_idx
  on public.marketing_activities (candidate_id, activity_date desc)
  where visibility = 'candidate_visible';

create trigger set_updated_at before update on public.marketing_activities
  for each row execute function util.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Default visibility by activity type.
--
-- Notes are internal. Everything else is part of the candidate's own story and
-- is shown to them. Staff may still override a specific row, but the DEFAULT is
-- decided here rather than at each call site — an omission at a call site would
-- otherwise leak an internal note into the portal.
-- ---------------------------------------------------------------------------
create or replace function util.default_activity_visibility(p_type activity_type)
returns document_visibility
language sql
immutable
as $$
  select case p_type
    when 'note' then 'internal'::document_visibility
    else 'candidate_visible'::document_visibility
  end
$$;

create or replace function util.tg_activity_default_visibility()
returns trigger
language plpgsql
as $$
begin
  -- Only on insert, and only when the caller did not decide explicitly.
  if tg_op = 'INSERT' and new.visibility = 'internal'
     and util.default_activity_visibility(new.activity_type) = 'candidate_visible' then
    new.visibility := 'candidate_visible';
  end if;

  -- A note is never candidate-visible, whatever the caller asked for.
  if new.activity_type = 'note' then
    new.visibility := 'internal';
  end if;

  return new;
end;
$$;

create trigger activity_default_visibility
  before insert or update on public.marketing_activities
  for each row execute function util.tg_activity_default_visibility();

-- ---------------------------------------------------------------------------
-- Audit every new table, using the existing infrastructure unchanged.
-- ---------------------------------------------------------------------------
create trigger audit_rows after insert or update or delete on public.applications
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.marketing_activities
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.application_status_history
  for each row execute function audit.tg_audit_row();
