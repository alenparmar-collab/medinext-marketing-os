-- ===========================================================================
-- 0015 — Automatic history and activity, count and timeline functions
--
-- WHY TRIGGERS RATHER THAN APPLICATION CODE
--
-- Every application write must produce a status-history row and a chronological
-- activity, because those are the aggregation source ("Applications = 80" is
-- counted from records, never typed into a report). If the application layer
-- were responsible for that, the guarantee would hold only for the code paths
-- someone remembered — and the email pipeline in a later build is exactly the
-- path most likely to be forgotten.
--
-- A trigger cannot be forgotten by a write path that does not know it exists.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Resolve the acting user the same way the audit trigger does, so a
-- service-role or background write is attributed rather than anonymous.
-- ---------------------------------------------------------------------------
create or replace function util.current_actor_id()
returns uuid
language plpgsql
stable
as $$
declare v_actor uuid;
begin
  begin
    v_actor := coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
  exception when others then
    v_actor := null;
  end;
  return v_actor;
end;
$$;

-- ---------------------------------------------------------------------------
-- On insert: record the opening status and log APPLICATION_SUBMITTED.
-- On status change: record the transition and log STATUS_CHANGE.
--
-- Nothing else about an application produces an activity — editing a job URL is
-- an audit-log event, not something that belongs on a candidate's timeline.
-- ---------------------------------------------------------------------------
create or replace function util.tg_application_history_and_activity()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := util.current_actor_id();
begin
  if tg_op = 'INSERT' then
    insert into public.application_status_history
      (application_id, from_status, to_status, changed_by, source_type, source_reference)
    values
      (new.id, null, new.status, v_actor, new.source_type, new.source_reference);

    insert into public.marketing_activities (
      business_unit_id, candidate_id, application_id, marketing_period_id,
      activity_type, activity_date, summary, details,
      source_type, source_reference, verified_at, verified_by, created_by
    )
    values (
      new.business_unit_id, new.candidate_id, new.id, new.marketing_period_id,
      'application_submitted', new.application_date::timestamptz,
      new.position_title || ' at ' || new.company_name,
      jsonb_build_object('company_name', new.company_name,
                         'position_title', new.position_title,
                         'status', new.status),
      new.source_type, new.source_reference,
      new.verified_at, new.verified_by, v_actor
    );

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.application_status_history
      (application_id, from_status, to_status, changed_by, source_type, source_reference)
    values
      (new.id, old.status, new.status, v_actor, new.source_type, new.source_reference);

    insert into public.marketing_activities (
      business_unit_id, candidate_id, application_id, marketing_period_id,
      activity_type, activity_date, summary, details,
      source_type, verified_at, verified_by, created_by
    )
    values (
      new.business_unit_id, new.candidate_id, new.id, new.marketing_period_id,
      'status_change', now(),
      new.company_name || ' — ' || old.status::text || ' to ' || new.status::text,
      jsonb_build_object('from_status', old.status, 'to_status', new.status,
                         'company_name', new.company_name),
      new.source_type,
      -- A status change made by a signed-in human is verified by that act.
      case when v_actor is not null then now() else null end,
      v_actor, v_actor
    );
  end if;

  return new;
end;
$$;

create trigger application_history_and_activity
  after insert or update on public.applications
  for each row execute function util.tg_application_history_and_activity();

-- ---------------------------------------------------------------------------
-- The trigger writes as the invoking user, so these two tables need INSERT
-- policies that its context satisfies.
--
-- HONEST STATEMENT OF THE GUARANTEE: these policies bound the write to
-- candidates the actor can already reach and to actors who hold the matching
-- capability. They do not make a history row unforgeable by someone who could
-- have performed the underlying change anyway — that person could simply make
-- the change. What they do prevent is anyone else writing history at all, and
-- every insert is independently captured in the audit log.
-- ---------------------------------------------------------------------------
-- The policy above is not sufficient on its own: RLS narrows a privilege, it
-- does not grant one. Without this the trigger fails with "permission denied".
grant insert on public.application_status_history to authenticated;

create policy application_status_history_insert on public.application_status_history
  for insert to authenticated
  with check (
    (select util.is_internal())
    and exists (
      select 1 from public.applications a
      where a.id = application_status_history.application_id
        and (select util.can_access_candidate(a.candidate_id))
    )
  );

-- No UPDATE or DELETE policy exists on application_status_history: the history
-- accumulates and is never edited.

-- ---------------------------------------------------------------------------
-- Aggregation: counts derived from actual records.
--
-- SECURITY INVOKER, so RLS filters exactly as it would for a direct query — a
-- recruiter's counts cover their candidates, a manager's the unit's, with no
-- role logic in here at all.
--
-- Interview and assessment counts come from ACTIVITIES rather than dedicated
-- tables, which do not exist yet. When later builds add them, this function
-- changes and every caller keeps working.
-- ---------------------------------------------------------------------------
create or replace function public.candidate_counts(p_candidate_ids uuid[])
returns table (
  candidate_id        uuid,
  applications        bigint,
  recruiter_responses bigint,
  interviews          bigint,
  assessments         bigint,
  rejections          bigint,
  offers              bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    (select count(*) from public.applications a where a.candidate_id = c.id),
    (select count(*) from public.marketing_activities m
      where m.candidate_id = c.id and m.activity_type = 'recruiter_response'),
    (select count(*) from public.marketing_activities m
      where m.candidate_id = c.id and m.activity_type = 'interview'),
    (select count(*) from public.marketing_activities m
      where m.candidate_id = c.id and m.activity_type = 'assessment'),
    (select count(*) from public.marketing_activities m
      where m.candidate_id = c.id and m.activity_type = 'rejection'),
    (select count(*) from public.marketing_activities m
      where m.candidate_id = c.id and m.activity_type = 'offer')
  from public.candidates c
  where c.id = any(p_candidate_ids)
$$;

-- ---------------------------------------------------------------------------
-- Candidate timeline.
--
-- One function serves BOTH audiences. It selects from RLS-protected tables as
-- the caller, so an internal user sees everything they may see and a candidate
-- sees only their own candidate_visible rows. There is no "include internal"
-- flag, deliberately: a boolean passed from the client is exactly the kind of
-- parameter that eventually gets passed wrong.
-- ---------------------------------------------------------------------------
create or replace function public.candidate_timeline(p_candidate_id uuid)
returns table (
  occurred_at   timestamptz,
  entry_kind    text,
  entry_id      uuid,
  title         text,
  detail        text,
  company_name  text,
  application_id uuid,
  status        text,
  source_type   source_kind,
  is_verified   boolean,
  actor_name    text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.activity_date,
    m.activity_type::text,
    m.id,
    m.summary,
    nullif(m.details ->> 'note', ''),
    coalesce(m.details ->> 'company_name', a.company_name),
    m.application_id,
    coalesce(m.details ->> 'to_status', a.status::text),
    m.source_type,
    m.is_verified,
    u.full_name
  from public.marketing_activities m
  left join public.applications a on a.id = m.application_id
  left join public.users u on u.id = m.created_by
  where m.candidate_id = p_candidate_id

  union all

  -- Marketing period boundaries are part of the story and have no activity row.
  select
    mp.starts_on::timestamptz,
    'marketing_started',
    mp.id,
    'Marketing started',
    mp.objective,
    null, null,
    mp.status::text,
    'manual'::source_kind,
    true,
    u.full_name
  from public.marketing_periods mp
  left join public.users u on u.id = mp.opened_by
  where mp.candidate_id = p_candidate_id

  union all

  select
    mp.ends_on::timestamptz,
    'marketing_ended',
    mp.id,
    'Marketing ended',
    null, null, null,
    mp.status::text,
    'manual'::source_kind,
    true,
    u.full_name
  from public.marketing_periods mp
  left join public.users u on u.id = mp.closed_by
  where mp.candidate_id = p_candidate_id and mp.ends_on is not null

  order by 1 desc
$$;

revoke all on function public.candidate_counts(uuid[]) from public, anon;
revoke all on function public.candidate_timeline(uuid) from public, anon;
grant execute on function public.candidate_counts(uuid[]) to authenticated, service_role;
grant execute on function public.candidate_timeline(uuid) to authenticated, service_role;
