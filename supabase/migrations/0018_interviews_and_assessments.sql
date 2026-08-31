-- ===========================================================================
-- 0018 — Interviews and assessments as first-class records
--
-- Build 3 recorded these as marketing_activities, which was right for counting
-- but cannot carry a schedule, a deadline, a meeting link or an outcome. They
-- become their own tables here. The activity system is NOT replaced: a trigger
-- in 0021 keeps one mirroring activity per record, so the timeline and the
-- derived counts continue to work unchanged.
--
-- CROSS-CANDIDATE ATTACHMENT IS STRUCTURALLY IMPOSSIBLE.
-- Both tables carry candidate_id and application_id, with a composite foreign
-- key to applications(id, candidate_id). Supplying candidate A's id alongside
-- candidate B's application fails the constraint — the database refuses it, so
-- no server-side check can be forgotten.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Controlled status vocabularies, centralised as enums so code branches on
-- them and no string literal is written into a component.
-- ---------------------------------------------------------------------------
create type interview_status as enum (
  'scheduled',
  'completed',
  'rescheduled',
  'cancelled',
  'no_show',
  'passed',
  'failed'
);

create type assessment_status as enum (
  'pending',
  'in_progress',
  'completed',
  'expired',
  'passed',
  'failed'
);

-- ---------------------------------------------------------------------------
-- Interviews
--
-- Company and position are deliberately NOT duplicated here: they belong to
-- the application and are derived from it. Copying them would create two
-- places for the same fact to be wrong.
-- ---------------------------------------------------------------------------
create table public.interviews (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  application_id   uuid not null references public.applications(id) on delete cascade,

  interview_round  smallint not null default 1 check (interview_round between 1 and 20),
  scheduled_at     timestamptz,
  -- The zone the interview was SCHEDULED in, kept alongside the instant.
  -- A candidate who misreads a time misses an interview, so the portal shows
  -- both their own zone and the scheduled one when they differ.
  time_zone        text,
  meeting_url      text check (meeting_url is null or meeting_url ~* '^https?://'),
  interviewer_name text,
  interviewer_email citext,

  status           interview_status not null default 'scheduled',
  notes            text,

  source_type      source_kind not null default 'manual',
  source_reference text,
  verified_at      timestamptz,
  verified_by      uuid references public.users(id),
  is_verified      boolean generated always as (verified_at is not null) stored,

  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  foreign key (candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id),
  -- The integrity guarantee: an interview cannot point at one candidate's
  -- application while claiming another candidate.
  foreign key (application_id, candidate_id)
    references public.applications (id, candidate_id),

  unique (id, candidate_id)
);

create index interviews_candidate_idx on public.interviews (candidate_id, scheduled_at desc);
create index interviews_application_idx on public.interviews (application_id);
create index interviews_upcoming_idx on public.interviews (business_unit_id, scheduled_at)
  where status in ('scheduled', 'rescheduled');

create trigger set_updated_at before update on public.interviews
  for each row execute function util.tg_set_updated_at();

comment on table public.interviews is
  'One application may have many interviews. Company and position are derived '
  'from the application rather than duplicated.';

-- ---------------------------------------------------------------------------
-- Schedule history — append-only.
--
-- When 2 September 11:00 becomes 3 September 14:00, the original must remain
-- recoverable. Written by a trigger in 0021 so no write path can skip it, and
-- with no UPDATE or DELETE policy so it accumulates rather than being edited.
-- ---------------------------------------------------------------------------
create table public.interview_schedule_history (
  id                  uuid primary key default gen_random_uuid(),
  interview_id        uuid not null references public.interviews(id) on delete cascade,

  change_kind         text not null
                        check (change_kind in ('scheduled','rescheduled','cancelled','status_change')),
  previous_scheduled_at timestamptz,
  previous_time_zone  text,
  previous_status     interview_status,
  new_scheduled_at    timestamptz,
  new_time_zone       text,
  new_status          interview_status,

  reason              text,
  changed_at          timestamptz not null default now(),
  changed_by          uuid references public.users(id),
  source_type         source_kind not null default 'manual',
  source_reference    text
);

create index interview_schedule_history_idx
  on public.interview_schedule_history (interview_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Assessments
-- ---------------------------------------------------------------------------
create table public.assessments (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  application_id   uuid not null references public.applications(id) on delete cascade,

  assessment_type  text not null check (length(btrim(assessment_type)) > 0),
  assessment_url   text check (assessment_url is null or assessment_url ~* '^https?://'),
  received_at      timestamptz not null default now(),
  deadline         timestamptz,
  completed_at     timestamptz,

  status           assessment_status not null default 'pending',
  outcome          text,
  notes            text,

  source_type      source_kind not null default 'manual',
  source_reference text,
  verified_at      timestamptz,
  verified_by      uuid references public.users(id),
  is_verified      boolean generated always as (verified_at is not null) stored,

  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint assessments_deadline_after_received
    check (deadline is null or deadline >= received_at),

  foreign key (candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id),
  foreign key (application_id, candidate_id)
    references public.applications (id, candidate_id),

  unique (id, candidate_id)
);

create index assessments_candidate_idx on public.assessments (candidate_id, received_at desc);
create index assessments_application_idx on public.assessments (application_id);
create index assessments_due_idx on public.assessments (business_unit_id, deadline)
  where status in ('pending', 'in_progress');

create trigger set_updated_at before update on public.assessments
  for each row execute function util.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Link activities back to the record that produced them.
--
-- Explicit nullable foreign keys rather than a polymorphic (type, id) pair:
-- polymorphic references cannot be foreign-keyed, cannot be indexed usefully
-- for joins, and rot silently.
--
-- The unique indexes are what make activity mirroring IDEMPOTENT: an interview
-- can never accumulate more than one mirroring activity, however many times it
-- is updated or a future pipeline retries.
-- ---------------------------------------------------------------------------
alter table public.marketing_activities
  add column interview_id  uuid references public.interviews(id) on delete cascade,
  add column assessment_id uuid references public.assessments(id) on delete cascade;

create unique index marketing_activities_interview_uk
  on public.marketing_activities (interview_id) where interview_id is not null;
create unique index marketing_activities_assessment_uk
  on public.marketing_activities (assessment_id) where assessment_id is not null;

-- ---------------------------------------------------------------------------
-- Audit, using the existing infrastructure unchanged.
-- ---------------------------------------------------------------------------
create trigger audit_rows after insert or update or delete on public.interviews
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.assessments
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.interview_schedule_history
  for each row execute function audit.tg_audit_row();
