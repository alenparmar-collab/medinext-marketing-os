-- ===========================================================================
-- 0029 — Atomic candidate reassignment
--
-- WHY THIS EXISTS
--
-- Moving a candidate from one recruiter to another is two writes: end the
-- current assignment, then create the new one. The order is forced by
-- `candidate_assignments_one_primary_uk` — a candidate cannot have two active
-- primary recruiters, so the old row must close before the new one opens.
--
-- supabase-js cannot wrap two PostgREST calls in one transaction. Doing this
-- from the application layer therefore has a real failure mode: the close
-- succeeds, the open fails, and the candidate is left with nobody working
-- their file and no error the user can act on. That is exactly the kind of
-- silent state loss the brief prohibits.
--
-- SECURITY INVOKER, so RLS filters both statements exactly as it would for a
-- direct query. This function adds atomicity, never authority: a caller
-- without candidate.assign still writes nothing.
-- ===========================================================================

create or replace function public.reassign_candidate(
  p_candidate_id    uuid,
  p_user_id         uuid,
  p_assignment_type assignment_type default 'primary_recruiter',
  p_starts_on       date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_actor       uuid := util.current_actor_id();
  v_unit        uuid;
  v_starts_on   date := coalesce(p_starts_on, current_date);
  v_current_id  uuid;
  v_current_user uuid;
  v_new_id      uuid;
begin
  -- RLS-filtered read. Not found here means "not visible to you", and we do
  -- not distinguish that from "does not exist".
  --
  -- Deliberately NOT `for update`: Postgres applies the UPDATE policy's USING
  -- clause to a locking read, so locking the candidate here would silently
  -- require candidate.update as well as candidate.assign. The row that has to
  -- be locked is the assignment, and that one is locked below.
  select business_unit_id into v_unit
    from public.candidates
   where id = p_candidate_id;

  if not found then
    raise exception 'candidate not found or not permitted' using errcode = '42501';
  end if;

  select id, user_id into v_current_id, v_current_user
    from public.candidate_assignments
   where candidate_id = p_candidate_id
     and assignment_type = p_assignment_type
     and ends_on is null
     for update;

  if v_current_user = p_user_id then
    raise exception 'that person already holds this assignment' using errcode = 'P0001';
  end if;

  -- Close first: the partial unique index would otherwise reject the insert.
  -- The row stays — an assignment is a history, not a pointer, and "who owned
  -- this candidate in August" must remain answerable.
  if v_current_id is not null then
    update public.candidate_assignments
       set ends_on  = greatest(v_starts_on, starts_on),
           ended_by = v_actor
     where id = v_current_id;

    -- A no-op update means the UPDATE policy refused it. Without this the
    -- transaction would carry on and open a second assignment.
    if not found then
      raise exception 'not permitted to end the current assignment' using errcode = '42501';
    end if;
  end if;

  insert into public.candidate_assignments
    (business_unit_id, candidate_id, user_id, assignment_type, starts_on, created_by)
  values
    (v_unit, p_candidate_id, p_user_id, p_assignment_type, v_starts_on, v_actor)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function public.reassign_candidate(uuid, uuid, assignment_type, date)
  from public, anon;
grant execute on function public.reassign_candidate(uuid, uuid, assignment_type, date)
  to authenticated, service_role;
