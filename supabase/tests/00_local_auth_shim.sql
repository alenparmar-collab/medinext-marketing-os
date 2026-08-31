-- ---------------------------------------------------------------------------
-- LOCAL TEST HARNESS ONLY — never applied to a Supabase project.
--
-- Supabase provides the auth schema, the auth.uid()/auth.jwt() helpers and the
-- anon/authenticated/service_role database roles. A bare PostgreSQL instance
-- does not, so this file recreates just enough of that surface for the
-- migrations and RLS tests to run locally.
--
-- The signatures match Supabase's so that a policy proven here behaves
-- identically there.
-- ---------------------------------------------------------------------------

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create table if not exists auth.users (
  id            uuid primary key,
  email         text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Supabase resolves the current user from the request's JWT claims, which
-- PostgREST publishes as the request.jwt.claims GUC. Tests set that GUC.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select auth.jwt() ->> 'role'
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- STORAGE SHIM
--
-- Supabase provides the storage schema, storage.objects and the
-- storage.foldername() helper. Without them the storage policies in 0011 and
-- 0023 skip themselves, which means the guarantee "a candidate cannot download
-- another candidate's file" would never actually be executed by any test.
--
-- Recreating just enough of that surface lets the REAL policies run locally
-- and be asserted against, rather than taken on trust.
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null references storage.buckets(id),
  name       text not null,
  owner      uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

-- Matches Supabase's helper: splits an object path into its segments, so
-- (storage.foldername(name))[1] is the candidate id under our path convention.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/')
$$;

alter table storage.objects enable row level security;
alter table storage.objects force row level security;

grant usage on schema storage to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
revoke all on storage.objects, storage.buckets from anon;
