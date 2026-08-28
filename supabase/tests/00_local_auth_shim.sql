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
