-- ===========================================================================
-- 0027 — Authorization hardening
--
-- Three gaps found while reading the existing policies for Build 5. None was
-- exploitable through the interface as built, but each was reachable through a
-- direct API call by a signed-in user, and Build 5 adds the administration
-- screens that make them worth closing now rather than later.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- GAP 1 — `users_update_self` was column-blind.
--
-- The policy correctly restricts a user to their OWN row, but RLS is
-- row-level: a signed-in user could PATCH their own row and set
-- `status = 'active'` after being suspended, or move themselves into another
-- `business_unit_id` and see that unit's candidates.
--
-- Postgres has column-level GRANT, but per the constraint documented in
-- docs/architecture/05 §2 it cannot vary by user — everyone is `authenticated`.
-- So the check has to be a trigger.
--
-- Self-service is limited to genuine profile fields. Anything that governs
-- access is administrative, and changing it requires user.manage.
-- ---------------------------------------------------------------------------
create or replace function util.tg_guard_user_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An administrator acting deliberately is fine.
  if util.has_permission('user.manage') then
    return new;
  end if;

  -- A background or migration write with no session actor is not a user
  -- editing themselves.
  if auth.uid() is null then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'account status can only be changed by an administrator'
      using errcode = '42501';
  end if;

  if new.business_unit_id is distinct from old.business_unit_id then
    raise exception 'business unit can only be changed by an administrator'
      using errcode = '42501';
  end if;

  if new.email is distinct from old.email then
    raise exception 'email address can only be changed by an administrator'
      using errcode = '42501';
  end if;

  if new.sessions_valid_from is distinct from old.sessions_valid_from then
    raise exception 'session validity can only be changed by an administrator'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_user_self_update
  before update on public.users
  for each row execute function util.tg_guard_user_self_update();

-- ---------------------------------------------------------------------------
-- GAP 2 — nothing structurally prevented granting the admin role.
--
-- Today `role.manage` is held only by admins, so in practice only an admin can
-- grant anything. But that is a property of the seed, not of the schema: give
-- a manager `role.manage` for some unrelated reason and they could make
-- themselves an administrator.
--
-- The brief says managers must not be able to create an admin. This makes that
-- true regardless of how the permission matrix is later tuned.
-- ---------------------------------------------------------------------------
create or replace function util.tg_guard_admin_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role_code <> 'admin' then
    return new;
  end if;

  -- Seeds and migrations run without a session actor.
  if auth.uid() is null then
    return new;
  end if;

  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role_code = 'admin'
  ) then
    raise exception 'only an administrator can grant the administrator role'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_admin_grant
  before insert or update on public.user_roles
  for each row execute function util.tg_guard_admin_grant();

-- ---------------------------------------------------------------------------
-- GAP 3 — a candidate-role account could be named as an assignee.
--
-- `candidate_assignments.user_id` references `users`, which includes portal
-- accounts. Assigning a candidate as somebody's recruiter would grant them
-- access to that candidate's records through the assignment branch of
-- util.can_access_candidate.
--
-- The role-exclusivity trigger from 0003 stops a candidate holding an internal
-- role; this stops one being treated as internal without holding the role.
-- ---------------------------------------------------------------------------
create or replace function util.tg_guard_assignee_is_internal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.user_id and ur.role_code = 'candidate'
  ) then
    raise exception 'a candidate portal account cannot be assigned to a candidate'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = new.user_id
      and ur.role_code in ('admin', 'manager', 'recruiter')
  ) then
    raise exception 'assignees must hold an internal role'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger guard_assignee_is_internal
  before insert or update on public.candidate_assignments
  for each row execute function util.tg_guard_assignee_is_internal();
