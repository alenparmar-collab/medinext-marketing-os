-- ===========================================================================
-- 0019 — Notifications
--
-- IDEMPOTENCY IS THE POINT OF THIS TABLE'S DESIGN.
--
-- Notifications are produced by triggers today and will be produced by the
-- email pipeline later. That pipeline will retry: a message re-delivered, a
-- classifier re-run, a job restarted after a crash. If a retry can create a
-- second "your interview was scheduled" notification, the feature becomes
-- noise the first week it goes live.
--
-- So every notification carries a dedupe_key that describes the EVENT, not the
-- moment of writing, and a unique index makes a duplicate physically
-- impossible rather than merely unlikely. Producers insert with
-- `on conflict do nothing`.
-- ===========================================================================

create type notification_type as enum (
  'interview_scheduled',
  'interview_updated',
  'interview_cancelled',
  'assessment_received',
  'assessment_updated',
  'application_updated',
  'important_marketing_update'
);

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),

  recipient_id     uuid not null references public.users(id) on delete cascade,
  notification_type notification_type not null,

  title            text not null check (length(btrim(title)) > 0),
  message          text,

  -- Where the notification points. Kept as a loose reference rather than a
  -- foreign key per entity: a notification about a deleted record should still
  -- read sensibly, and the UI resolves the link from these two columns.
  entity_type      text,
  entity_id        uuid,

  -- Describes the underlying EVENT. Two producers observing the same event
  -- must derive the same key.
  dedupe_key       text not null,

  read_at          timestamptz,
  created_at       timestamptz not null default now()
);

-- The idempotency guarantee. Scoped per recipient, because the same event
-- legitimately notifies several people.
create unique index notifications_dedupe_uk
  on public.notifications (recipient_id, dedupe_key);

-- Serves the unread badge and the inbox, which are the only two hot queries.
create index notifications_inbox_idx
  on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (recipient_id) where read_at is null;

create trigger audit_rows after insert or update or delete on public.notifications
  for each row execute function audit.tg_audit_row();

-- ---------------------------------------------------------------------------
-- The single producer.
--
-- SECURITY DEFINER because notifications are addressed to OTHER people: a
-- recruiter's action notifies a candidate, and the recruiter has no write
-- access to that candidate's notification row. Definer rights are the reason
-- clients cannot call this — execute is granted to service_role only, and the
-- triggers that use it run inside the database.
--
-- Returns the id, or null when the event had already been recorded.
-- ---------------------------------------------------------------------------
create or replace function util.emit_notification(
  p_business_unit_id  uuid,
  p_recipient_id      uuid,
  p_type              notification_type,
  p_title             text,
  p_message           text,
  p_entity_type       text,
  p_entity_id         uuid,
  p_dedupe_key        text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_recipient_id is null then
    return null;
  end if;

  insert into public.notifications (
    business_unit_id, recipient_id, notification_type,
    title, message, entity_type, entity_id, dedupe_key
  )
  values (
    p_business_unit_id, p_recipient_id, p_type,
    p_title, p_message, p_entity_type, p_entity_id, p_dedupe_key
  )
  on conflict (recipient_id, dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function util.emit_notification(uuid, uuid, notification_type, text, text, text, uuid, text)
  from public, anon;

-- EXECUTE is granted to `authenticated` because the notification triggers run
-- as the invoking user, and a trigger that cannot call this would fail the
-- business write it hangs off.
--
-- That is not a way in for a client: `util` is deliberately absent from the
-- PostgREST exposed-schema list (migration 0001), so there is no HTTP path to
-- this function. The unexposed schema is the boundary; the definer rights are
-- what let a recruiter's action notify a candidate they cannot otherwise write
-- to. The `notifications` table itself still has no INSERT policy, so nothing
-- can create one except through here.
grant execute on function util.emit_notification(uuid, uuid, notification_type, text, text, text, uuid, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who hears about a candidate.
--
-- The candidate's own portal account, when one exists, plus everyone currently
-- assigned to them. Computed at send time rather than stored, so unassigning
-- someone stops their notifications immediately.
-- ---------------------------------------------------------------------------
create or replace function util.candidate_audience(p_candidate_id uuid)
returns table (user_id uuid, is_candidate boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.user_id, true
  from public.candidates c
  join public.users u on u.id = c.user_id
  where c.id = p_candidate_id and u.status = 'active'

  union

  select ca.user_id, false
  from public.candidate_assignments ca
  join public.users u on u.id = ca.user_id
  where ca.candidate_id = p_candidate_id
    and ca.ends_on is null
    and u.status = 'active'
$$;

revoke all on function util.candidate_audience(uuid) from public, anon;
grant execute on function util.candidate_audience(uuid) to authenticated, service_role;
