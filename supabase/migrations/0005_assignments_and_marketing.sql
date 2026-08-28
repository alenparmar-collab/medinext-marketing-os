-- ===========================================================================
-- 0005 — Candidate assignments and marketing periods
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Assignments are a HISTORY, not a pointer (docs/architecture/01 §4.2).
--
-- Rows are never deleted. Ending an assignment sets ends_on, which both
-- revokes access immediately and preserves the answer to "who owned this
-- candidate on the day the offer came in".
-- ---------------------------------------------------------------------------
create table public.candidate_assignments (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete restrict,
  assignment_type  assignment_type not null default 'primary_recruiter',

  starts_on        date not null default current_date,
  ends_on          date,

  -- Generated, not stored independently: an is_active flag that can disagree
  -- with the dates is a bug waiting to happen.
  is_active        boolean generated always as (ends_on is null) stored,

  created_by       uuid references public.users(id),
  ended_by         uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint candidate_assignments_dates_ordered
    check (ends_on is null or ends_on >= starts_on),
  foreign key (candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id)
);

-- At most one active primary recruiter per candidate.
create unique index candidate_assignments_one_primary_uk
  on public.candidate_assignments (candidate_id)
  where assignment_type = 'primary_recruiter' and ends_on is null;

-- A user is not assigned to the same candidate twice concurrently in the same capacity.
create unique index candidate_assignments_active_uk
  on public.candidate_assignments (candidate_id, user_id, assignment_type)
  where ends_on is null;

-- Load-bearing: every recruiter RLS check reads this index.
create index candidate_assignments_active_by_user
  on public.candidate_assignments (user_id, candidate_id)
  where ends_on is null;

create index candidate_assignments_candidate_idx
  on public.candidate_assignments (candidate_id);

create trigger set_updated_at before update on public.candidate_assignments
  for each row execute function util.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Marketing periods.
-- ---------------------------------------------------------------------------
create table public.marketing_periods (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,

  starts_on        date not null,
  ends_on          date,
  status           marketing_status not null default 'onboarding',

  objective        text,
  opened_by        uuid references public.users(id),
  closed_by        uuid references public.users(id),
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint marketing_periods_dates_ordered
    check (ends_on is null or ends_on >= starts_on),
  foreign key (candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id),

  -- Lets a later build's applications table point at (period, candidate) and
  -- be structurally unable to drift onto a different candidate.
  unique (id, candidate_id)
);

create index marketing_periods_candidate_idx
  on public.marketing_periods (candidate_id, starts_on desc);
create index marketing_periods_open_idx
  on public.marketing_periods (business_unit_id, status) where ends_on is null;

create trigger set_updated_at before update on public.marketing_periods
  for each row execute function util.tg_set_updated_at();

-- No two overlapping live periods for one candidate. This catches the common
-- data-entry error of opening a second period without closing the first.
-- Open decision D-07: drop this if parallel marketing tracks are legitimate.
alter table public.marketing_periods
  add constraint marketing_periods_no_overlap
  exclude using gist (
    candidate_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') with &&
  )
  where (status in ('onboarding','ready_for_marketing','active','paused','on_hold'));
