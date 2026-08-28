-- ===========================================================================
-- 0001 — Schemas, extensions, shared conventions
--
-- Schema layout follows docs/architecture/02 §0. Only `public` is exposed to
-- PostgREST; `audit` and `util` are reachable only from SECURITY DEFINER
-- functions and the service role. `ingest` and `staging` are deliberately NOT
-- created in Build 2 — they arrive with their own builds.
-- ===========================================================================

create extension if not exists pgcrypto;      -- gen_random_uuid()
create extension if not exists citext;        -- case-insensitive email
create extension if not exists btree_gist;    -- exclusion constraints on ranges
create extension if not exists pg_trgm;       -- fuzzy candidate name search

create schema if not exists audit;
create schema if not exists util;

revoke all on schema audit from public;
revoke all on schema util  from public;
grant usage on schema util to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest without relying on the application.
-- ---------------------------------------------------------------------------
create or replace function util.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function util.tg_set_updated_at is
  'Sets updated_at on every UPDATE. Attached to all business tables.';
