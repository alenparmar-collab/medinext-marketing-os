-- ===========================================================================
-- 0017 — Atomic status change with an optional note
--
-- WHY THIS EXISTS
--
-- A status change is two writes: the application row, and the history row the
-- trigger derives from it. The optional note belongs on the history row.
--
-- The application layer cannot write that note itself: application_status_history
-- deliberately has no UPDATE policy, because history that can be edited is not
-- history. And supabase-js cannot wrap the two statements in one transaction —
-- each PostgREST call is its own.
--
-- So the note travels to the trigger through a transaction-local setting, set
-- inside a SECURITY INVOKER function. Invoker, not definer: RLS still filters
-- the update exactly as it would for a direct query, so this adds atomicity
-- without granting any authority.
-- ===========================================================================

create or replace function util.tg_application_history_and_activity()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := util.current_actor_id();
  v_note  text := nullif(current_setting('app.status_note', true), '');
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
      (application_id, from_status, to_status, changed_by, source_type, source_reference, note)
    values
      (new.id, old.status, new.status, v_actor, new.source_type, new.source_reference, v_note);

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
                         'company_name', new.company_name,
                         'note', v_note),
      new.source_type,
      case when v_actor is not null then now() else null end,
      v_actor, v_actor
    );
  end if;

  return new;
end;
$$;

create or replace function public.change_application_status(
  p_application_id uuid,
  p_status         application_status,
  p_note           text default null
)
returns application_status
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old application_status;
  v_new application_status;
begin
  -- RLS-filtered: not found here means not permitted, and we do not
  -- distinguish the two.
  select status into v_old from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'application not found or not permitted' using errcode = '42501';
  end if;

  if v_old = p_status then
    raise exception 'the application already has that status' using errcode = 'P0001';
  end if;

  -- Transaction-local, so it cannot leak into another request on a pooled
  -- connection.
  perform set_config('app.status_note', coalesce(p_note, ''), true);

  update public.applications
     set status = p_status,
         updated_by = util.current_actor_id()
   where id = p_application_id
  returning status into v_new;

  perform set_config('app.status_note', '', true);

  return v_new;
end;
$$;

revoke all on function public.change_application_status(uuid, application_status, text)
  from public, anon;
grant execute on function public.change_application_status(uuid, application_status, text)
  to authenticated, service_role;
