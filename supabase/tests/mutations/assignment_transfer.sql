-- ---------------------------------------------------------------------------
-- MUTATION: make a transfer add an owner instead of moving one.
--
-- The guarantee under test is that reassigning a candidate MOVES them: the
-- previous assignment closes, exactly one stays active, and the closed row
-- survives as history.
--
-- This version opens the new assignment without closing the old one, and drops
-- the partial unique index that would otherwise stop it. If the suite still
-- passes, it is not actually checking that a transfer transfers — it is only
-- checking that a row was inserted.
-- ---------------------------------------------------------------------------
drop index if exists public.candidate_assignments_one_primary_uk;

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
  v_actor        uuid := util.current_actor_id();
  v_unit         uuid;
  v_starts_on    date := coalesce(p_starts_on, current_date);
  v_current_user uuid;
  v_new_id       uuid;
begin
  select business_unit_id into v_unit
    from public.candidates
   where id = p_candidate_id;

  if not found then
    raise exception 'candidate not found or not permitted' using errcode = '42501';
  end if;

  select user_id into v_current_user
    from public.candidate_assignments
   where candidate_id = p_candidate_id
     and assignment_type = p_assignment_type
     and ends_on is null;

  if v_current_user = p_user_id then
    raise exception 'that person already holds this assignment' using errcode = 'P0001';
  end if;

  insert into public.candidate_assignments
    (business_unit_id, candidate_id, user_id, assignment_type, starts_on, created_by)
  values
    (v_unit, p_candidate_id, p_user_id, p_assignment_type, v_starts_on, v_actor)
  returning id into v_new_id;

  return v_new_id;
end;
$$;
