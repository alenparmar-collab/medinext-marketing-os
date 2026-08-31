-- ===========================================================================
-- 0021 — Automation for interviews and assessments
--
-- Three things happen automatically whenever an interview or assessment is
-- written, by any path, now or later:
--
--   1. A mirroring marketing_activity is kept in sync, so the timeline and the
--      derived counts from Build 3 keep working without change.
--   2. Schedule and status changes append to interview_schedule_history.
--   3. The candidate and their assignees are notified, idempotently.
--
-- All in triggers, not application code, for the reason established in Build 3:
-- a trigger cannot be forgotten by a write path that does not know it exists,
-- and the email pipeline in a later build is the path most likely to forget.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Interviews -> mirroring activity
--
-- Upsert, not insert. The unique index on marketing_activities(interview_id)
-- means an interview can never accumulate more than one mirroring activity, so
-- repeated updates and future pipeline retries converge instead of piling up.
-- ---------------------------------------------------------------------------
create or replace function util.tg_interview_sync()
returns trigger
language plpgsql
as $$
declare
  v_actor   uuid := util.current_actor_id();
  v_company text;
  v_role    text;
  v_summary text;
begin
  select a.company_name, a.position_title
    into v_company, v_role
  from public.applications a
  where a.id = new.application_id;

  v_summary := format('Round %s interview — %s at %s',
                      new.interview_round, coalesce(v_role, 'role'), coalesce(v_company, 'company'));

  insert into public.marketing_activities (
    business_unit_id, candidate_id, application_id, interview_id,
    activity_type, activity_date, summary, details,
    source_type, source_reference, verified_at, verified_by, created_by
  )
  values (
    new.business_unit_id, new.candidate_id, new.application_id, new.id,
    'interview', coalesce(new.scheduled_at, now()), v_summary,
    jsonb_build_object(
      'company_name', v_company,
      'position_title', v_role,
      'round', new.interview_round,
      'status', new.status,
      'scheduled_at', new.scheduled_at,
      'time_zone', new.time_zone
    ),
    new.source_type, new.source_reference, new.verified_at, new.verified_by, v_actor
  )
  on conflict (interview_id) where interview_id is not null
  do update set
    activity_date = coalesce(excluded.activity_date, public.marketing_activities.activity_date),
    summary       = excluded.summary,
    details       = excluded.details,
    updated_at    = now();

  return new;
end;
$$;

create trigger interview_sync_activity
  after insert or update on public.interviews
  for each row execute function util.tg_interview_sync();

-- ---------------------------------------------------------------------------
-- Interviews -> schedule history
--
-- The reason travels through a transaction-local setting, the same mechanism
-- 0017 uses for status-change notes: the history table has no UPDATE policy,
-- so the reason has to arrive with the row rather than be attached afterwards.
-- ---------------------------------------------------------------------------
create or replace function util.tg_interview_history()
returns trigger
language plpgsql
as $$
declare
  v_actor  uuid := util.current_actor_id();
  v_reason text := nullif(current_setting('app.schedule_reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.interview_schedule_history (
      interview_id, change_kind, new_scheduled_at, new_time_zone, new_status,
      reason, changed_by, source_type, source_reference
    )
    values (
      new.id, 'scheduled', new.scheduled_at, new.time_zone, new.status,
      v_reason, v_actor, new.source_type, new.source_reference
    );
    return new;
  end if;

  -- A moved interview. The previous instant and zone are preserved verbatim,
  -- which is the whole point: 2 September 11:00 must stay recoverable after it
  -- becomes 3 September 14:00.
  if new.scheduled_at is distinct from old.scheduled_at
     or new.time_zone is distinct from old.time_zone then
    insert into public.interview_schedule_history (
      interview_id, change_kind,
      previous_scheduled_at, previous_time_zone, previous_status,
      new_scheduled_at, new_time_zone, new_status,
      reason, changed_by, source_type, source_reference
    )
    values (
      new.id, 'rescheduled',
      old.scheduled_at, old.time_zone, old.status,
      new.scheduled_at, new.time_zone, new.status,
      v_reason, v_actor, new.source_type, new.source_reference
    );
  elsif new.status is distinct from old.status then
    insert into public.interview_schedule_history (
      interview_id, change_kind,
      previous_scheduled_at, previous_time_zone, previous_status,
      new_scheduled_at, new_time_zone, new_status,
      reason, changed_by, source_type, source_reference
    )
    values (
      new.id,
      case when new.status = 'cancelled' then 'cancelled' else 'status_change' end,
      old.scheduled_at, old.time_zone, old.status,
      new.scheduled_at, new.time_zone, new.status,
      v_reason, v_actor, new.source_type, new.source_reference
    );
  end if;

  return new;
end;
$$;

create trigger interview_history
  after insert or update on public.interviews
  for each row execute function util.tg_interview_history();

-- ---------------------------------------------------------------------------
-- Interviews -> notifications
--
-- The dedupe key describes the EVENT, so re-running the same change produces
-- nothing. Rescheduling to a genuinely new time is a different event and does
-- notify, which is the behaviour you want.
-- ---------------------------------------------------------------------------
create or replace function util.tg_interview_notify()
returns trigger
language plpgsql
as $$
declare
  v_company  text;
  v_role     text;
  v_type     notification_type;
  v_title    text;
  v_message  text;
  v_key      text;
  v_audience record;
begin
  if tg_op = 'UPDATE'
     and new.scheduled_at is not distinct from old.scheduled_at
     and new.time_zone   is not distinct from old.time_zone
     and new.status      is not distinct from old.status
     and new.meeting_url is not distinct from old.meeting_url then
    -- Editing a note or an interviewer name is not worth a notification.
    return new;
  end if;

  select a.company_name, a.position_title into v_company, v_role
  from public.applications a where a.id = new.application_id;

  if tg_op = 'INSERT' then
    v_type := 'interview_scheduled';
    v_title := 'Interview scheduled';
    v_key := format('interview:%s:scheduled:%s', new.id, coalesce(new.scheduled_at::text, 'tbc'));
  elsif new.status = 'cancelled' then
    v_type := 'interview_cancelled';
    v_title := 'Interview cancelled';
    v_key := format('interview:%s:cancelled', new.id);
  elsif new.scheduled_at is distinct from old.scheduled_at then
    v_type := 'interview_updated';
    v_title := 'Interview moved';
    v_key := format('interview:%s:rescheduled:%s', new.id, coalesce(new.scheduled_at::text, 'tbc'));
  else
    v_type := 'interview_updated';
    v_title := 'Interview updated';
    v_key := format('interview:%s:status:%s', new.id, new.status);
  end if;

  v_message := format('Round %s for %s at %s.',
                      new.interview_round, coalesce(v_role, 'the role'), coalesce(v_company, 'the company'));

  for v_audience in select * from util.candidate_audience(new.candidate_id) loop
    perform util.emit_notification(
      new.business_unit_id, v_audience.user_id, v_type, v_title, v_message,
      'interview', new.id, v_key
    );
  end loop;

  return new;
end;
$$;

create trigger interview_notify
  after insert or update on public.interviews
  for each row execute function util.tg_interview_notify();

-- ---------------------------------------------------------------------------
-- Assessments -> activity, notifications
-- ---------------------------------------------------------------------------
create or replace function util.tg_assessment_sync()
returns trigger
language plpgsql
as $$
declare
  v_actor   uuid := util.current_actor_id();
  v_company text;
  v_role    text;
begin
  select a.company_name, a.position_title into v_company, v_role
  from public.applications a where a.id = new.application_id;

  insert into public.marketing_activities (
    business_unit_id, candidate_id, application_id, assessment_id,
    activity_type, activity_date, summary, details,
    source_type, source_reference, verified_at, verified_by, created_by
  )
  values (
    new.business_unit_id, new.candidate_id, new.application_id, new.id,
    'assessment', new.received_at,
    format('%s assessment — %s', new.assessment_type, coalesce(v_company, 'company')),
    jsonb_build_object(
      'company_name', v_company,
      'position_title', v_role,
      'assessment_type', new.assessment_type,
      'status', new.status,
      'deadline', new.deadline,
      'outcome', new.outcome
    ),
    new.source_type, new.source_reference, new.verified_at, new.verified_by, v_actor
  )
  on conflict (assessment_id) where assessment_id is not null
  do update set
    activity_date = excluded.activity_date,
    summary       = excluded.summary,
    details       = excluded.details,
    updated_at    = now();

  return new;
end;
$$;

create trigger assessment_sync_activity
  after insert or update on public.assessments
  for each row execute function util.tg_assessment_sync();

create or replace function util.tg_assessment_notify()
returns trigger
language plpgsql
as $$
declare
  v_company  text;
  v_type     notification_type;
  v_title    text;
  v_key      text;
  v_audience record;
begin
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.deadline is not distinct from old.deadline
     and new.assessment_url is not distinct from old.assessment_url then
    return new;
  end if;

  select a.company_name into v_company
  from public.applications a where a.id = new.application_id;

  if tg_op = 'INSERT' then
    v_type := 'assessment_received';
    v_title := 'Assessment received';
    v_key := format('assessment:%s:received', new.id);
  else
    v_type := 'assessment_updated';
    v_title := 'Assessment updated';
    v_key := format('assessment:%s:status:%s:%s', new.id, new.status,
                    coalesce(new.deadline::text, 'no-deadline'));
  end if;

  for v_audience in select * from util.candidate_audience(new.candidate_id) loop
    perform util.emit_notification(
      new.business_unit_id, v_audience.user_id, v_type, v_title,
      format('%s assessment for %s.', new.assessment_type, coalesce(v_company, 'the role')),
      'assessment', new.id, v_key
    );
  end loop;

  return new;
end;
$$;

create trigger assessment_notify
  after insert or update on public.assessments
  for each row execute function util.tg_assessment_notify();

-- ---------------------------------------------------------------------------
-- Applications -> notification on a status change.
--
-- Only the status. Editing a job URL is an audit event, not news.
-- ---------------------------------------------------------------------------
create or replace function util.tg_application_notify()
returns trigger
language plpgsql
as $$
declare v_audience record;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  for v_audience in select * from util.candidate_audience(new.candidate_id) loop
    perform util.emit_notification(
      new.business_unit_id, v_audience.user_id, 'application_updated',
      'Application updated',
      format('%s at %s is now %s.', new.position_title, new.company_name, new.status),
      'application', new.id,
      format('application:%s:status:%s', new.id, new.status)
    );
  end loop;

  return new;
end;
$$;

create trigger application_notify
  after update on public.applications
  for each row execute function util.tg_application_notify();

-- ---------------------------------------------------------------------------
-- Reschedule with a reason, atomically.
--
-- SECURITY INVOKER: RLS filters the update exactly as a direct query would, so
-- this adds atomicity without granting any authority.
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_interview(
  p_interview_id  uuid,
  p_scheduled_at  timestamptz,
  p_time_zone     text default null,
  p_reason        text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from public.interviews where id = p_interview_id for update;
  if not found then
    raise exception 'interview not found or not permitted' using errcode = '42501';
  end if;

  perform set_config('app.schedule_reason', coalesce(p_reason, ''), true);

  update public.interviews
     set scheduled_at = p_scheduled_at,
         time_zone    = coalesce(p_time_zone, time_zone),
         status       = case when status = 'scheduled' then 'rescheduled'::interview_status
                             else status end,
         updated_by   = util.current_actor_id()
   where id = p_interview_id;

  perform set_config('app.schedule_reason', '', true);
  return p_interview_id;
end;
$$;

revoke all on function public.reschedule_interview(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.reschedule_interview(uuid, timestamptz, text, text)
  to authenticated, service_role;
