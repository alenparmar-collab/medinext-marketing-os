-- ===========================================================================
-- 0026 — Derived report metrics, confirmation, review checks, and hardening
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- THE DERIVED METRICS.
--
-- This function is the ONLY definition of what a recruiter's day amounts to.
-- Nothing stores these numbers; they are counted from the records every time.
--
-- ATTRIBUTION RULE, applied uniformly to all five figures:
--   the record was RECORDED BY that user (created_by), and the record's own
--   business date falls on the report date.
--
-- One rule rather than five keeps the report explicable to the person reading
-- it: "these are the things you entered, dated that day". A record created by
-- someone else, or dated differently, belongs on a different line.
--
-- SECURITY INVOKER, so RLS filters it exactly as a direct query would.
-- ---------------------------------------------------------------------------
create or replace function public.daily_report_metrics(
  p_recruiter_id uuid,
  p_report_date  date
)
returns table (
  applications        bigint,
  recruiter_responses bigint,
  interviews          bigint,
  assessments         bigint,
  rejections          bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*) from public.applications a
      where a.created_by = p_recruiter_id
        and a.application_date = p_report_date),

    (select count(*) from public.marketing_activities m
      where m.created_by = p_recruiter_id
        and m.activity_type = 'recruiter_response'
        and (m.activity_date at time zone 'UTC')::date = p_report_date),

    (select count(*) from public.interviews i
      where i.created_by = p_recruiter_id
        and (i.scheduled_at at time zone 'UTC')::date = p_report_date),

    (select count(*) from public.assessments s
      where s.created_by = p_recruiter_id
        and (s.received_at at time zone 'UTC')::date = p_report_date),

    (select count(*) from public.marketing_activities m
      where m.created_by = p_recruiter_id
        and m.activity_type = 'rejection'
        and (m.activity_date at time zone 'UTC')::date = p_report_date)
$$;

revoke all on function public.daily_report_metrics(uuid, date) from public, anon;
grant execute on function public.daily_report_metrics(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Confirmation.
--
-- Freezes the derived figures onto the report and marks it confirmed, in one
-- transaction. It touches no source record — the whole point of a snapshot is
-- that reconciling does not alter what is being reconciled.
--
-- SECURITY INVOKER: RLS decides whether this caller may write this report, so
-- the function adds atomicity without granting authority. The `draft` guard
-- makes re-confirming a no-op rather than a second snapshot.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_daily_report(
  p_report_id uuid,
  p_notes        text default null,
  p_observations text default null,
  p_exceptions   text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_recruiter uuid;
  v_date      date;
  v_status    daily_report_status;
  v_metrics   record;
begin
  select recruiter_id, report_date, status
    into v_recruiter, v_date, v_status
  from public.daily_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'report not found or not permitted' using errcode = '42501';
  end if;

  if v_status = 'confirmed' then
    raise exception 'this report has already been confirmed' using errcode = 'P0001';
  end if;

  select * into v_metrics from public.daily_report_metrics(v_recruiter, v_date);

  update public.daily_reports
     set status = 'confirmed',
         notes        = coalesce(p_notes, notes),
         observations = coalesce(p_observations, observations),
         exceptions   = coalesce(p_exceptions, exceptions),
         snapshot_applications        = v_metrics.applications,
         snapshot_recruiter_responses = v_metrics.recruiter_responses,
         snapshot_interviews          = v_metrics.interviews,
         snapshot_assessments         = v_metrics.assessments,
         snapshot_rejections          = v_metrics.rejections,
         snapshot_taken_at            = now(),
         confirmed_by = util.current_actor_id(),
         confirmed_at = now()
   where id = p_report_id;

  return p_report_id;
end;
$$;

revoke all on function public.confirm_daily_report(uuid, text, text, text) from public, anon;
grant execute on function public.confirm_daily_report(uuid, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Review checks.
--
-- Deterministic consistency checks over existing records. No classification,
-- no inference, no judgement about anyone's conduct — each check is a plain
-- SQL condition, and the reason text says only what is factually missing or
-- inconsistent.
--
-- Idempotent by dedupe_key, so running it repeatedly converges. That is also
-- what will make it safe for a scheduled job later.
--
-- SECURITY DEFINER because it writes items about candidates the caller may not
-- individually own, and because a scheduled job has no session. Execute is
-- granted only to the service role and to holders of review.manage.
-- ---------------------------------------------------------------------------
create or replace function public.run_review_checks(p_business_unit_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_created integer := 0;
begin
  -- An interview whose scheduled time has passed but which nobody has closed.
  insert into public.review_items (
    business_unit_id, item_type, priority, candidate_id, interview_id,
    reason, detail, source_type, dedupe_key
  )
  select
    i.business_unit_id, 'incomplete_record', 'normal', i.candidate_id, i.id,
    'Interview time has passed and no outcome has been recorded',
    format('Scheduled %s, still marked %s.', i.scheduled_at, i.status),
    'system', format('interview:%s:awaiting_outcome', i.id)
  from public.interviews i
  where i.business_unit_id = p_business_unit_id
    and i.scheduled_at < now() - interval '1 day'
    and i.status in ('scheduled', 'rescheduled')
  on conflict (business_unit_id, dedupe_key) do nothing;
  get diagnostics v_created = row_count;

  -- An assessment past its deadline that is still open.
  insert into public.review_items (
    business_unit_id, item_type, priority, candidate_id, assessment_id,
    reason, detail, source_type, dedupe_key
  )
  select
    a.business_unit_id, 'incomplete_record', 'high', a.candidate_id, a.id,
    'Assessment deadline has passed and no result has been recorded',
    format('Deadline was %s, still marked %s.', a.deadline, a.status),
    'system', format('assessment:%s:past_deadline', a.id)
  from public.assessments a
  where a.business_unit_id = p_business_unit_id
    and a.deadline < now()
    and a.status in ('pending', 'in_progress')
  on conflict (business_unit_id, dedupe_key) do nothing;

  -- An active candidate nobody is assigned to.
  insert into public.review_items (
    business_unit_id, item_type, priority, candidate_id,
    reason, detail, source_type, dedupe_key
  )
  select
    c.business_unit_id, 'missing_information', 'normal', c.id,
    'Candidate is being marketed but has no assigned recruiter',
    format('Marketing status is %s.', c.marketing_status),
    'system', format('candidate:%s:unassigned', c.id)
  from public.candidates c
  where c.business_unit_id = p_business_unit_id
    and c.archived_at is null
    and c.marketing_status in ('ready_for_marketing', 'active')
    and not exists (
      select 1 from public.candidate_assignments ca
      where ca.candidate_id = c.id and ca.ends_on is null
    )
  on conflict (business_unit_id, dedupe_key) do nothing;

  -- Two active candidate records sharing an email address. Flagged for a
  -- person to look at; nothing is merged or altered automatically.
  insert into public.review_items (
    business_unit_id, item_type, priority, candidate_id,
    reason, detail, source_type, dedupe_key
  )
  select distinct on (c.business_unit_id, lower(c.email::text))
    c.business_unit_id, 'possible_duplicate', 'high', c.id,
    'More than one active candidate record shares this email address',
    format('Email %s appears on several records.', c.email),
    'system', format('candidate_email:%s:duplicate', lower(c.email::text))
  from public.candidates c
  where c.business_unit_id = p_business_unit_id
    and c.archived_at is null
    and exists (
      select 1 from public.candidates other
      where other.id <> c.id
        and other.archived_at is null
        and other.business_unit_id = c.business_unit_id
        and lower(other.email::text) = lower(c.email::text)
    )
  order by c.business_unit_id, lower(c.email::text), c.created_at
  on conflict (business_unit_id, dedupe_key) do nothing;

  -- An application with neither a job reference nor a link.
  insert into public.review_items (
    business_unit_id, item_type, priority, candidate_id, application_id,
    reason, detail, source_type, dedupe_key
  )
  select
    a.business_unit_id, 'missing_information', 'low', a.candidate_id, a.id,
    'Application has no job reference or link',
    format('%s at %s.', a.position_title, a.company_name),
    'system', format('application:%s:no_reference', a.id)
  from public.applications a
  where a.business_unit_id = p_business_unit_id
    and a.job_id is null
    and a.job_url is null
    and a.status not in ('rejected', 'withdrawn', 'closed')
  on conflict (business_unit_id, dedupe_key) do nothing;

  return (
    select count(*)::integer from public.review_items
    where business_unit_id = p_business_unit_id and status = 'open'
  );
end;
$$;

revoke all on function public.run_review_checks(uuid) from public, anon, authenticated;
grant execute on function public.run_review_checks(uuid) to service_role;

-- Callable by a person holding review.manage, without granting it to every
-- signed-in user.
create or replace function public.request_review_checks()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_unit uuid;
begin
  if not util.has_permission('review.manage') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select business_unit_id into v_unit from public.users where id = auth.uid();
  if v_unit is null then
    raise exception 'no business unit for this user' using errcode = 'P0001';
  end if;

  return public.run_review_checks(v_unit);
end;
$$;

revoke all on function public.request_review_checks() from public, anon;
grant execute on function public.request_review_checks() to authenticated, service_role;
