-- ===========================================================================
-- 0003 — Tenancy, users, roles and permissions
--
-- Decision D-13 (resolved): the business-unit boundary exists from the first
-- migration. Every business table carries business_unit_id NOT NULL, and the
-- tenant gate is evaluated before any permission or scope check.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Business units — the tenant boundary.
--
-- Named `business_units` rather than `organization_units` to stay
-- unambiguously distinct from external companies (clients, vendors), which a
-- later build models as `organizations`.
-- ---------------------------------------------------------------------------
create table public.business_units (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code = upper(code) and length(code) between 2 and 24),
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger set_updated_at before update on public.business_units
  for each row execute function util.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Application user profile, one row per auth.users row.
--
-- The application never joins to auth.users directly: that table is owned by
-- Supabase and its shape is not ours to depend on.
-- ---------------------------------------------------------------------------
create table public.users (
  id               uuid primary key references auth.users(id) on delete restrict,
  business_unit_id uuid references public.business_units(id),
  email            citext not null unique,
  full_name        text not null check (length(btrim(full_name)) > 0),
  job_title        text,
  status           user_status not null default 'invited',
  -- Any token issued before this timestamp is refused by the server layer.
  -- This is what stops a revoked permission living on inside an existing JWT
  -- until it expires (docs/architecture/03 §5).
  sessions_valid_from timestamptz not null default now(),
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index users_business_unit_idx on public.users (business_unit_id);

create trigger set_updated_at before update on public.users
  for each row execute function util.tg_set_updated_at();

comment on column public.users.business_unit_id is
  'Null only for a platform-level admin holding unit.view_all.';

-- ---------------------------------------------------------------------------
-- Roles and permissions.
--
-- Application code checks capabilities, never role names, so widening a role
-- is a seed row rather than a code change (docs/architecture/03 §2).
-- ---------------------------------------------------------------------------
create table public.roles (
  code        text primary key check (code in ('admin','manager','recruiter','candidate')),
  name        text not null,
  description text not null,
  rank        smallint not null unique   -- display ordering only, not inheritance
);

create table public.permissions (
  code        text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  domain      text not null,
  description text not null
);

create table public.role_permissions (
  role_code       text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

create table public.user_roles (
  user_id    uuid not null references public.users(id) on delete cascade,
  role_code  text not null references public.roles(code),
  granted_by uuid references public.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_code)
);

create index user_roles_role_idx on public.user_roles (role_code);

-- ---------------------------------------------------------------------------
-- The candidate role is exclusive.
--
-- A portal account must never be able to acquire an internal role laterally,
-- so this is enforced in the database rather than by application convention.
-- ---------------------------------------------------------------------------
create or replace function util.tg_enforce_exclusive_candidate_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.user_roles ur
    where ur.user_id = new.user_id
      and (ur.role_code = 'candidate') is distinct from (new.role_code = 'candidate')
  ) then
    raise exception
      'the candidate role cannot be combined with internal roles (user %)', new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger enforce_exclusive_candidate_role
  before insert or update on public.user_roles
  for each row execute function util.tg_enforce_exclusive_candidate_role();
