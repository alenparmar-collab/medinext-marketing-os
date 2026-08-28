-- ===========================================================================
-- 0007 — Audit infrastructure
--
-- Two rules make this trustworthy rather than decorative:
--   1. Capture happens in DATABASE TRIGGERS, not application code. Application
--      auditing is always incomplete — it misses SQL functions, imports, admin
--      corrections, and whatever the next developer forgets to wrap.
--   2. The table is append-only, enforced by GRANTs and a trigger, including
--      against the service role. No application path can amend the record.
-- ===========================================================================

create table audit.audit_logs (
  id            bigint generated always as identity,
  occurred_at   timestamptz not null default now(),

  actor_id      uuid,
  actor_kind    actor_kind not null default 'user',
  actor_roles   text[],

  action        text not null,           -- insert | update | delete | login | export | ...
  entity_type   text not null,           -- table name, or a domain event name
  entity_id     uuid,
  entity_schema text,

  changed_fields text[],
  old_data      jsonb,
  new_data      jsonb,

  -- Extensible carrier for future email-generated activity: which pipeline,
  -- which message, what confidence, without needing a schema change.
  source        source_kind not null default 'manual',
  metadata      jsonb not null default '{}'::jsonb,

  request_id    uuid,
  ip_address    inet,
  user_agent    text,

  primary key (id, occurred_at)
) partition by range (occurred_at);

create index audit_logs_entity_idx on audit.audit_logs (entity_type, entity_id, occurred_at desc);
create index audit_logs_actor_idx  on audit.audit_logs (actor_id, occurred_at desc);
create index audit_logs_action_idx on audit.audit_logs (action, occurred_at desc);

-- A DEFAULT partition means a missing monthly partition degrades to "row lands
-- somewhere" rather than "the write fails and takes the business transaction
-- with it". Auditing must never be the reason a valid action is rejected.
create table audit.audit_logs_default partition of audit.audit_logs default;

-- ---------------------------------------------------------------------------
-- Monthly partitions, created ahead of time by a scheduled job.
-- ---------------------------------------------------------------------------
create or replace function util.ensure_audit_partition(p_month date)
returns void
language plpgsql
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := 'audit_logs_' || to_char(v_start, 'YYYY_MM');
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'audit' and c.relname = v_name
  ) then
    return;
  end if;

  execute format(
    'create table audit.%I partition of audit.audit_logs for values from (%L) to (%L)',
    v_name, v_start, v_end
  );
end;
$$;

comment on function util.ensure_audit_partition is
  'Creates one monthly audit partition if absent. Call from a scheduled job for '
  'the next two months; safe to run repeatedly.';

-- ---------------------------------------------------------------------------
-- Immutability.
--
-- The service role is included in the revoke deliberately: the point is that
-- no application path, however privileged, can rewrite history.
-- ---------------------------------------------------------------------------
revoke all on audit.audit_logs from public, anon, authenticated, service_role;

create or replace function audit.tg_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit.audit_logs is append-only (attempted %)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_logs_no_update
  before update on audit.audit_logs
  for each row execute function audit.tg_reject_mutation();

create trigger audit_logs_no_delete
  before delete on audit.audit_logs
  for each row execute function audit.tg_reject_mutation();

-- ---------------------------------------------------------------------------
-- The generic row auditor.
--
-- Actor resolution takes auth.uid() when a user is acting, and falls back to
-- the app.actor_id GUC so that service-role and background writes are
-- attributed rather than anonymous.
-- ---------------------------------------------------------------------------
create or replace function audit.tg_audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid;
  v_old      jsonb;
  v_new      jsonb;
  v_changed  text[];
  v_id       uuid;
begin
  begin
    v_actor := coalesce(
      auth.uid(),
      nullif(current_setting('app.actor_id', true), '')::uuid
    );
  exception when others then
    v_actor := null;
  end;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);

    select coalesce(array_agg(key order by key), '{}')
      into v_changed
      from jsonb_each(v_new) as e(key, value)
     where v_new -> e.key is distinct from v_old -> e.key;

    -- A save that only touched bookkeeping columns is not an audit event.
    -- Without this the log fills with noise and stops being readable.
    if v_changed <@ array['updated_at','updated_by'] then
      return new;
    end if;
  end if;

  v_id := coalesce((v_new ->> 'id'), (v_old ->> 'id'))::uuid;

  insert into audit.audit_logs (
    actor_id, actor_kind, action, entity_type, entity_id, entity_schema,
    changed_fields, old_data, new_data, source, request_id
  )
  values (
    v_actor,
    case when v_actor is null then 'system'::public.actor_kind else 'user'::public.actor_kind end,
    lower(tg_op),
    tg_table_name,
    v_id,
    tg_table_schema,
    v_changed,
    v_old,
    v_new,
    coalesce(
      nullif(current_setting('app.source', true), '')::public.source_kind,
      'manual'::public.source_kind
    ),
    nullif(current_setting('app.request_id', true), '')::uuid
  );

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Attach to every business table that exists today. Later builds add their own
-- tables to this list; the RLS test suite fails a table that is missing it.
-- ---------------------------------------------------------------------------
create trigger audit_rows after insert or update or delete on public.candidates
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.candidate_assignments
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.marketing_periods
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.documents
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.users
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.user_roles
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.candidate_internal_notes
  for each row execute function audit.tg_audit_row();
create trigger audit_rows after insert or update or delete on public.role_permissions
  for each row execute function audit.tg_audit_row();

-- ---------------------------------------------------------------------------
-- Non-row events (login, export, document download, permission change) cannot
-- be seen by a trigger. The server layer writes them through this function.
-- ---------------------------------------------------------------------------
create or replace function public.record_audit_event(
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'record_audit_event requires an authenticated actor'
      using errcode = 'insufficient_privilege';
  end if;

  insert into audit.audit_logs (
    actor_id, actor_kind, actor_roles, action, entity_type, entity_id,
    source, metadata, request_id
  )
  values (
    v_actor,
    'user',
    (select coalesce(array_agg(ur.role_code), '{}')
       from public.user_roles ur where ur.user_id = v_actor),
    p_action,
    p_entity_type,
    p_entity_id,
    'manual',
    coalesce(p_metadata, '{}'::jsonb),
    nullif(current_setting('app.request_id', true), '')::uuid
  );
end;
$$;

revoke all on function public.record_audit_event(text, text, uuid, jsonb) from public, anon;
grant execute on function public.record_audit_event(text, text, uuid, jsonb) to authenticated, service_role;
