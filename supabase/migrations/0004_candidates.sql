-- ===========================================================================
-- 0004 — Candidates
--
-- A candidate is a PERSON, not an engagement (docs/architecture/01 §4.1).
-- One human being is one row, forever. Being marketed, stopping, and being
-- marketed again is two marketing_periods on one candidate — which is what
-- keeps the timeline, documents and history continuous.
-- ===========================================================================

create sequence public.candidate_reference_seq;

create or replace function util.next_candidate_reference()
returns text
language sql
volatile
as $$
  select 'MDX-' || lpad(nextval('public.candidate_reference_seq')::text, 5, '0')
$$;

create table public.candidates (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  reference        text not null unique default util.next_candidate_reference(),

  -- Portal login link. Null until the candidate is invited (docs/architecture/03 §6).
  user_id          uuid unique references public.users(id) on delete set null,

  -- Identity and contact
  full_name        text not null check (length(btrim(full_name)) > 0),
  email            citext not null,
  phone            text,

  -- Professional profile. These are the Build 2 fields as specified.
  primary_skill    text,
  skills           text[] not null default '{}',
  total_experience_months integer check (total_experience_months >= 0),
  current_location text,
  visa_status      text,
  education        text,
  certifications   text[] not null default '{}',

  -- OPTIONAL by product rule. There is deliberately no NOT NULL, no default,
  -- no check constraint, and nothing anywhere in this system that requires a
  -- preferred location or compares it against anything else.
  preferred_locations text[] not null default '{}',

  marketing_status marketing_status not null default 'onboarding',

  -- Convenience pointer to the current resume. The document itself lives in
  -- public.documents; the FK is added in 0006 once that table exists.
  primary_resume_document_id uuid,

  archived_at      timestamptz,
  created_source   source_kind not null default 'manual',
  created_source_id uuid,
  created_by       uuid references public.users(id),
  updated_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Supports the composite FKs that keep child rows in their parent's unit.
  unique (id, business_unit_id)
);

-- One active candidate per email address per business unit. Archived rows are
-- excluded so a returning candidate can be re-created without a collision.
create unique index candidates_email_active_uk
  on public.candidates (business_unit_id, email)
  where archived_at is null;

create index candidates_business_unit_idx on public.candidates (business_unit_id);
create index candidates_marketing_status_idx
  on public.candidates (business_unit_id, marketing_status) where archived_at is null;
create index candidates_full_name_trgm
  on public.candidates using gin (full_name gin_trgm_ops);
create index candidates_user_idx on public.candidates (user_id) where user_id is not null;

create trigger set_updated_at before update on public.candidates
  for each row execute function util.tg_set_updated_at();

comment on column public.candidates.preferred_locations is
  'OPTIONAL. No business rule requires this to be set, and nothing compares it '
  'against current_location or against any job location. See README, product rules.';

comment on column public.candidates.visa_status is
  'Free text in Build 2. Becomes a lookup table once the business supplies its '
  'actual value set (open decision D-06); modelling it as an enum now would be '
  'inventing values.';

-- ---------------------------------------------------------------------------
-- Internal notes live in their own table, never as a column on candidates.
--
-- RLS is row-level, not column-level: a candidate who can read their own row
-- can read every column of it. Internal commentary therefore cannot sit on a
-- candidate-visible row (docs/architecture/05 §3).
-- ---------------------------------------------------------------------------
create table public.candidate_internal_notes (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  body             text not null check (length(btrim(body)) > 0),
  pinned           boolean not null default false,
  created_by       uuid not null references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id)
);

create index candidate_internal_notes_candidate_idx
  on public.candidate_internal_notes (candidate_id, created_at desc);

create trigger set_updated_at before update on public.candidate_internal_notes
  for each row execute function util.tg_set_updated_at();
