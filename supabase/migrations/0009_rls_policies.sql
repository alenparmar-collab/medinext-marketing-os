-- ===========================================================================
-- 0009 — Row Level Security
--
-- THE CONSTRAINT THAT SHAPES THIS FILE (docs/architecture/05 §2):
-- Supabase has three database roles — anon, authenticated, service_role — and
-- every logged-in user, admin and candidate alike, connects as `authenticated`.
-- GRANT therefore cannot separate internal users from candidates. All
-- per-user separation must come from the predicates below.
--
-- Consequences applied throughout:
--   * RLS is ENABLED and FORCED on every table, so a table with no matching
--     policy returns zero rows rather than everything.
--   * Policies are written PER COMMAND, never FOR ALL. FOR ALL hides that
--     USING gates reads and deletes while WITH CHECK gates writes, which is
--     how tables end up accidentally writable.
--   * Helper calls are wrapped as (select util.fn()) so Postgres caches them
--     per statement rather than per row.
--   * Build 2 portal posture is READ-ONLY (decision D-01): candidates hold
--     SELECT policies and nothing else, on any table.
-- ===========================================================================

alter table public.business_units            enable row level security;
alter table public.users                     enable row level security;
alter table public.roles                     enable row level security;
alter table public.permissions               enable row level security;
alter table public.role_permissions          enable row level security;
alter table public.user_roles                enable row level security;
alter table public.candidates                enable row level security;
alter table public.candidate_internal_notes  enable row level security;
alter table public.candidate_assignments     enable row level security;
alter table public.marketing_periods         enable row level security;
alter table public.documents                 enable row level security;
alter table public.document_types            enable row level security;

alter table public.business_units            force row level security;
alter table public.users                     force row level security;
alter table public.roles                     force row level security;
alter table public.permissions               force row level security;
alter table public.role_permissions          force row level security;
alter table public.user_roles                force row level security;
alter table public.candidates                force row level security;
alter table public.candidate_internal_notes  force row level security;
alter table public.candidate_assignments     force row level security;
alter table public.marketing_periods         force row level security;
alter table public.documents                 force row level security;
alter table public.document_types            force row level security;

-- ---------------------------------------------------------------------------
-- Reference data: readable by any signed-in user, writable only by admin.
-- These carry no personal data and no tenant dimension.
-- ---------------------------------------------------------------------------
create policy roles_select on public.roles
  for select to authenticated using (true);
create policy permissions_select on public.permissions
  for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);
create policy document_types_select on public.document_types
  for select to authenticated using (true);

create policy role_permissions_write on public.role_permissions
  for insert to authenticated with check ((select util.has_permission('permission.manage')));
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated using ((select util.has_permission('permission.manage')));
create policy document_types_write on public.document_types
  for insert to authenticated with check ((select util.has_permission('lookup.manage')));
create policy document_types_update on public.document_types
  for update to authenticated
  using ((select util.has_permission('lookup.manage')))
  with check ((select util.has_permission('lookup.manage')));

-- ---------------------------------------------------------------------------
-- Business units
-- ---------------------------------------------------------------------------
create policy business_units_select on public.business_units
  for select to authenticated
  using ((select util.in_business_unit(id)));

create policy business_units_write on public.business_units
  for insert to authenticated
  with check ((select util.has_permission('unit.manage')));

create policy business_units_update on public.business_units
  for update to authenticated
  using ((select util.has_permission('unit.manage')))
  with check ((select util.has_permission('unit.manage')));

-- ---------------------------------------------------------------------------
-- Users
--
-- Everyone reads their own row. Internal users additionally read colleagues in
-- their own business unit. A candidate reads ONLY their own row — they must
-- not be able to enumerate staff.
-- ---------------------------------------------------------------------------
create policy users_select_self on public.users
  for select to authenticated
  using (id = (select auth.uid()));

create policy users_select_colleagues on public.users
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.in_business_unit(business_unit_id))
  );

create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy users_manage on public.users
  for insert to authenticated
  with check ((select util.has_permission('user.manage')));

create policy users_update_admin on public.users
  for update to authenticated
  using ((select util.has_permission('user.manage')) and (select util.in_business_unit(business_unit_id)))
  with check ((select util.has_permission('user.manage')));

-- ---------------------------------------------------------------------------
-- User roles
--
-- Readable by the holder and by internal colleagues; writable only with
-- role.manage. A user changing their own roles is a privilege-escalation path,
-- so the write policy has no self-service branch.
-- ---------------------------------------------------------------------------
create policy user_roles_select_self on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_roles_select_internal on public.user_roles
  for select to authenticated
  using (
    (select util.is_internal())
    and exists (
      select 1 from public.users u
      where u.id = user_roles.user_id
        and (select util.in_business_unit(u.business_unit_id))
    )
  );

create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check ((select util.has_permission('role.manage')));

create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using ((select util.has_permission('role.manage')));

-- ---------------------------------------------------------------------------
-- Candidates
--
-- Two independent SELECT paths. Postgres ORs permissive policies together, so
-- an internal user matches the first and a portal user the second; neither can
-- widen the other.
-- ---------------------------------------------------------------------------
create policy candidates_select_internal on public.candidates
  for select to authenticated
  using ((select util.can_access_candidate(id)));

create policy candidates_select_own on public.candidates
  for select to authenticated
  using (id = (select util.own_candidate_id()));

create policy candidates_insert on public.candidates
  for insert to authenticated
  with check (
    (select util.has_permission('candidate.create'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy candidates_update on public.candidates
  for update to authenticated
  using ((select util.can_manage_candidate(id)))
  with check (
    (select util.can_manage_candidate(id))
    and (select util.in_business_unit(business_unit_id))
  );

-- Deletion is an admin correction, not an ordinary operation. Everything else
-- archives (candidates.archived_at).
create policy candidates_delete on public.candidates
  for delete to authenticated
  using (
    (select util.has_permission('candidate.delete'))
    and (select util.in_business_unit(business_unit_id))
  );

-- ---------------------------------------------------------------------------
-- Candidate internal notes — internal only.
--
-- There is deliberately NO _select_own policy. A candidate reaching this table
-- gets zero rows rather than an error, which is also correct for not leaking
-- the existence of notes about them.
-- ---------------------------------------------------------------------------
create policy candidate_internal_notes_select on public.candidate_internal_notes
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.can_access_candidate(candidate_id))
  );

create policy candidate_internal_notes_insert on public.candidate_internal_notes
  for insert to authenticated
  with check (
    (select util.is_internal())
    and (select util.can_access_candidate(candidate_id))
    and created_by = (select auth.uid())
  );

create policy candidate_internal_notes_update on public.candidate_internal_notes
  for update to authenticated
  using ((select util.is_internal()) and created_by = (select auth.uid()))
  with check ((select util.is_internal()) and created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Candidate assignments
--
-- A recruiter can see the assignment rows for candidates they can access,
-- which includes their own. Only candidate.assign holders write them.
-- Candidates see nothing here: who works their file is internal.
-- ---------------------------------------------------------------------------
create policy candidate_assignments_select on public.candidate_assignments
  for select to authenticated
  using (
    (select util.is_internal())
    and (
      user_id = (select auth.uid())
      or (select util.can_access_candidate(candidate_id))
    )
  );

create policy candidate_assignments_insert on public.candidate_assignments
  for insert to authenticated
  with check (
    (select util.has_permission('candidate.assign'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy candidate_assignments_update on public.candidate_assignments
  for update to authenticated
  using (
    (select util.has_permission('candidate.assign'))
    and (select util.in_business_unit(business_unit_id))
  )
  with check (
    (select util.has_permission('candidate.assign'))
    and (select util.in_business_unit(business_unit_id))
  );

-- ---------------------------------------------------------------------------
-- Marketing periods
-- ---------------------------------------------------------------------------
create policy marketing_periods_select_internal on public.marketing_periods
  for select to authenticated
  using ((select util.can_access_candidate(candidate_id)));

create policy marketing_periods_select_own on public.marketing_periods
  for select to authenticated
  using (candidate_id = (select util.own_candidate_id()));

create policy marketing_periods_insert on public.marketing_periods
  for insert to authenticated
  with check (
    (select util.has_permission('marketing_period.manage'))
    and (select util.can_access_candidate(candidate_id))
    and (select util.in_business_unit(business_unit_id))
  );

create policy marketing_periods_update on public.marketing_periods
  for update to authenticated
  using (
    (select util.has_permission('marketing_period.manage'))
    and (select util.can_access_candidate(candidate_id))
  )
  with check (
    (select util.has_permission('marketing_period.manage'))
    and (select util.can_access_candidate(candidate_id))
  );

-- ---------------------------------------------------------------------------
-- Documents
--
-- The candidate SELECT policy is the important one: a candidate reads only
-- files someone deliberately marked candidate_visible, under their own
-- candidate id, and not soft-deleted. Uploading does not publish.
-- ---------------------------------------------------------------------------
create policy documents_select_internal on public.documents
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.can_access_candidate(candidate_id))
  );

create policy documents_select_own on public.documents
  for select to authenticated
  using (
    candidate_id = (select util.own_candidate_id())
    and visibility = 'candidate_visible'
    and deleted_at is null
  );

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    (select util.has_permission('document.upload'))
    and (select util.can_access_candidate(candidate_id))
    and (select util.in_business_unit(business_unit_id))
  );

create policy documents_update on public.documents
  for update to authenticated
  using (
    (select util.has_permission('document.upload'))
    and (select util.can_access_candidate(candidate_id))
  )
  with check (
    (select util.has_permission('document.upload'))
    and (select util.can_access_candidate(candidate_id))
  );

create policy documents_delete on public.documents
  for delete to authenticated
  using (
    (select util.has_permission('document.delete'))
    and (select util.can_access_candidate(candidate_id))
  );
