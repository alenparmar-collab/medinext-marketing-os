-- ===========================================================================
-- 0008 — Authorization helper functions
--
-- Every one of these is SECURITY DEFINER, STABLE, with a pinned empty
-- search_path. Two reasons they must be definer functions:
--
--   1. Recursion. A policy on `candidates` that queries `candidate_assignments`
--      would otherwise fire that table's policies, which query back. Definer
--      functions read with the owner's rights and stop the loop.
--   2. They are the only place RLS is bypassed, which is exactly why they are
--      small, take no user-supplied SQL, and are audited as a unit.
--
-- PERFORMANCE: policies must call these as `(select util.fn())`. Postgres then
-- evaluates them once per statement instead of once per row — on a large scan
-- that is roughly two orders of magnitude (docs/architecture/05 §4).
-- ===========================================================================

create or replace function util.current_user_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select auth.uid()
$$;

create or replace function util.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.status = 'active'
  )
$$;

create or replace function util.has_permission(p_code text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    where ur.user_id = auth.uid()
      and rp.permission_code = p_code
  )
$$;

create or replace function util.has_role(p_role text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role_code = p_role
  )
$$;

create or replace function util.is_internal()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles ur
    join public.users u on u.id = ur.user_id
    where ur.user_id = auth.uid()
      and u.status = 'active'
      and ur.role_code in ('admin','manager','recruiter')
  )
$$;

-- ---------------------------------------------------------------------------
-- Tenancy gate. Evaluated before any permission or scope check.
-- No permission short of unit.view_all crosses a business unit — admin
-- permissions included.
-- ---------------------------------------------------------------------------
create or replace function util.in_business_unit(p_unit_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    p_unit_id is not null
    and (
      exists (
        select 1 from public.user_roles ur
        join public.role_permissions rp on rp.role_code = ur.role_code
        where ur.user_id = auth.uid() and rp.permission_code = 'unit.view_all'
      )
      or p_unit_id = (select u.business_unit_id from public.users u where u.id = auth.uid())
    )
$$;

-- ---------------------------------------------------------------------------
-- The candidate row belonging to the signed-in portal user, or null.
--
-- Requires the user to be active and the candidate not archived, so
-- deactivating either cuts portal access immediately without deleting the
-- link between person and record.
-- ---------------------------------------------------------------------------
create or replace function util.own_candidate_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select c.id
  from public.candidates c
  join public.users u on u.id = c.user_id
  where c.user_id = auth.uid()
    and u.status = 'active'
    and c.archived_at is null
$$;

-- ---------------------------------------------------------------------------
-- The single scope predicate every internal candidate-scoped policy funnels
-- through. The tenant gate lives INSIDE it, so every table that uses it
-- inherits unit isolation and cannot forget it.
-- ---------------------------------------------------------------------------
create or replace function util.can_access_candidate(p_candidate_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select
    util.is_active_user()
    and exists (
      select 1 from public.candidates c
      where c.id = p_candidate_id
        and util.in_business_unit(c.business_unit_id)
    )
    and (
      util.has_permission('candidate.view_all')
      or exists (
        select 1 from public.candidate_assignments ca
        where ca.candidate_id = p_candidate_id
          and ca.user_id = auth.uid()
          and ca.ends_on is null
      )
    )
$$;

-- Write scope: the same rows, plus the relevant capability.
create or replace function util.can_manage_candidate(p_candidate_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select util.has_permission('candidate.update')
     and util.can_access_candidate(p_candidate_id)
$$;

grant execute on function
  util.current_user_id(), util.is_active_user(), util.has_permission(text),
  util.has_role(text), util.is_internal(), util.in_business_unit(uuid),
  util.own_candidate_id(), util.can_access_candidate(uuid), util.can_manage_candidate(uuid)
to authenticated, service_role;
