-- ===========================================================================
-- 0033 — Email security: credentials, privileges, RLS, permissions
--
-- Email is the most sensitive data in the product. A single mailbox contains
-- candidates' personal circumstances, clients' hiring intentions, and salary
-- discussions, all mixed together and none of it filtered. It gets the
-- strictest treatment in the codebase:
--
--   * candidates have no access of any kind — not a policy, not a grant;
--   * internal users need an explicit capability, which recruiters do not hold
--     by default;
--   * provider tokens are not in `public` at all, and are encrypted before
--     they reach Postgres;
--   * nothing but the service role may write an email row.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Credentials live outside `public`, so PostgREST cannot reach them.
--
-- Supabase exposes `public` (and whatever else is configured). A table in
-- `private` with no grants to `authenticated` is unreachable through the API
-- regardless of what any policy says, which is the property we want for a
-- refresh token: not "protected by a rule" but "not addressable".
--
-- The ciphertext is produced by the application (AES-256-GCM, key from the
-- environment) before the value is sent. Postgres never sees the plaintext and
-- never holds the key, so a database dump — or a backup, or a support session
-- with read access — yields nothing usable.
--
-- The OAuth CLIENT SECRET is not here and is not in any table. It belongs to
-- the deployment, not to a mailbox.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to service_role;

create table private.mailbox_credentials (
  mailbox_id              uuid primary key
                          references public.mailboxes(id) on delete cascade,

  -- Ciphertext, base64. Never a readable token.
  refresh_token_encrypted text not null,
  access_token_encrypted  text,
  access_token_expires_at timestamptz,

  -- Which scopes the user actually granted, so a later build can check rather
  -- than assume. Not a secret.
  granted_scopes          text[] not null default '{}',
  -- Lets the encryption key be rotated without guessing which rows are stale.
  key_version             smallint not null default 1,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table private.mailbox_credentials enable row level security;
alter table private.mailbox_credentials force row level security;

-- No policies, and no grants to authenticated or anon. The only reader is the
-- service role, which bypasses RLS by design.
revoke all on private.mailbox_credentials from public, anon, authenticated;
grant all on private.mailbox_credentials to service_role;

comment on table private.mailbox_credentials is
  'OAuth tokens, encrypted by the application before insert. Not exposed to '
  'PostgREST. Service role only. Never referenced from a client component.';

-- ---------------------------------------------------------------------------
-- Capabilities.
--
-- Recruiters get NOTHING here. That is a deliberate default, not an oversight:
-- a marketing mailbox contains every candidate's correspondence, including
-- candidates a given recruiter has no business reading, and this build has no
-- per-candidate filter to apply because nothing has been matched to a
-- candidate yet. Widening it is a seed row once the business decides who
-- should see what.
-- ---------------------------------------------------------------------------
insert into public.permissions (code, domain, description) values
  ('mailbox.view',   'email', 'See connected mailboxes and their sync state.'),
  ('mailbox.manage', 'email', 'Connect, disconnect and synchronise a mailbox.'),
  ('email.view',     'email', 'Read ingested email evidence in the explorer.')
on conflict (code) do update
  set domain = excluded.domain, description = excluded.description;

insert into public.role_permissions (role_code, permission_code)
select 'admin', code from public.permissions where domain = 'email'
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('manager', 'mailbox.view'),
  ('manager', 'email.view')
on conflict do nothing;

-- Note what is absent: manager does not get mailbox.manage (connecting a
-- mailbox is an administrator's act), and recruiter appears nowhere at all.

-- ---------------------------------------------------------------------------
-- Table privileges.
--
-- Read-only for internal users. Every write to an email table happens in the
-- ingestion service under the service role, so there is no INSERT or UPDATE
-- grant to hand out and no policy that could be widened into one.
--
-- Mailboxes are the exception: connecting one is a deliberate act by an
-- administrator, through the normal request path.
-- ---------------------------------------------------------------------------
grant select on
  public.email_threads,
  public.email_messages,
  public.email_attachments,
  public.mailbox_sync_runs
to authenticated;

grant select, insert, update on public.mailboxes to authenticated;

grant all on
  public.mailboxes,
  public.email_threads,
  public.email_messages,
  public.email_attachments,
  public.mailbox_sync_runs
to service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security.
--
-- Every policy carries the same three conditions: internal, capable, and in
-- the right tenant. There is no candidate branch on any of these tables — not
-- a restrictive one, not one that returns nothing. The absence is the point:
-- a policy that mentions candidates is a policy somebody can widen.
-- ---------------------------------------------------------------------------
alter table public.mailboxes          enable row level security;
alter table public.email_threads      enable row level security;
alter table public.email_messages     enable row level security;
alter table public.email_attachments  enable row level security;
alter table public.mailbox_sync_runs  enable row level security;

alter table public.mailboxes          force row level security;
alter table public.email_threads      force row level security;
alter table public.email_messages     force row level security;
alter table public.email_attachments  force row level security;
alter table public.mailbox_sync_runs  force row level security;

create policy mailboxes_select on public.mailboxes
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('mailbox.view'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy mailboxes_insert on public.mailboxes
  for insert to authenticated
  with check (
    (select util.has_permission('mailbox.manage'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy mailboxes_update on public.mailboxes
  for update to authenticated
  using (
    (select util.has_permission('mailbox.manage'))
    and (select util.in_business_unit(business_unit_id))
  )
  with check (
    (select util.has_permission('mailbox.manage'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy email_threads_select on public.email_threads
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('email.view'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy email_messages_select on public.email_messages
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('email.view'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy email_attachments_select on public.email_attachments
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('email.view'))
    and (select util.in_business_unit(business_unit_id))
  );

-- Sync runs are operational, not content. They follow mailbox.view rather than
-- email.view, so somebody can be told the mailbox is healthy without being
-- given the correspondence.
create policy mailbox_sync_runs_select on public.mailbox_sync_runs
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('mailbox.view'))
    and (select util.in_business_unit(business_unit_id))
  );

-- No DELETE policy on any of these tables. Evidence is not deleted through the
-- application; removing a mailbox cascades, and that is a deliberate,
-- administrator-only act.

-- ---------------------------------------------------------------------------
-- Private storage for preserved originals.
--
-- Raw MIME and attachment bytes, in a bucket with NO policies for
-- `authenticated` at all. Only the service role can read or write it, so a
-- signed URL can exist only if server-side code decided to mint one after an
-- authorization check. Build 6 mints none.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent — skipping email evidence bucket (local test database)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('email-evidence', 'email-evidence', false, 52428800)  -- 50 MB
  on conflict (id) do update
    set public = false, file_size_limit = excluded.file_size_limit;
end $$;
