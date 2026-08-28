-- ===========================================================================
-- 0014 — Row Level Security for applications and activities
--
-- Same shape as 0009: RLS enabled AND forced, per-command policies, helper
-- calls wrapped as (select util.fn()) for per-statement evaluation, and the
-- tenant gate inherited through util.can_access_candidate().
--
-- The portal read paths are the security-critical ones:
--   * A candidate reads their OWN applications only.
--   * A candidate reads their own activities only, and only those marked
--     candidate_visible — which excludes every note by construction (0013).
-- ===========================================================================

alter table public.applications              enable row level security;
alter table public.application_status_history enable row level security;
alter table public.marketing_activities      enable row level security;

alter table public.applications               force row level security;
alter table public.application_status_history force row level security;
alter table public.marketing_activities       force row level security;

-- ---------------------------------------------------------------------------
-- Applications
-- ---------------------------------------------------------------------------
create policy applications_select_internal on public.applications
  for select to authenticated
  using ((select util.can_access_candidate(candidate_id)));

create policy applications_select_own on public.applications
  for select to authenticated
  using (candidate_id = (select util.own_candidate_id()));

create policy applications_insert on public.applications
  for insert to authenticated
  with check (
    (select util.has_permission('application.create'))
    and (select util.can_access_candidate(candidate_id))
    and (select util.in_business_unit(business_unit_id))
  );

create policy applications_update on public.applications
  for update to authenticated
  using (
    (select util.has_permission('application.update'))
    and (select util.can_access_candidate(candidate_id))
  )
  with check (
    (select util.has_permission('application.update'))
    and (select util.can_access_candidate(candidate_id))
  );

-- Deliberately narrow: an application is a historical fact. Ordinary
-- correction is a status change to 'withdrawn' or 'closed'; deletion is an
-- admin-only correction of a mistaken entry.
create policy applications_delete on public.applications
  for delete to authenticated
  using (
    (select util.has_permission('application.delete'))
    and (select util.can_access_candidate(candidate_id))
  );

-- ---------------------------------------------------------------------------
-- Status history — readable with the application, never writable by hand.
--
-- There is NO insert/update/delete policy. Rows are written exclusively by the
-- SECURITY DEFINER transition function in 0015, so the history cannot be
-- forged or edited even by an admin through the API.
-- ---------------------------------------------------------------------------
create policy application_status_history_select_internal on public.application_status_history
  for select to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = application_status_history.application_id
        and (select util.can_access_candidate(a.candidate_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Marketing activities
-- ---------------------------------------------------------------------------
create policy marketing_activities_select_internal on public.marketing_activities
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.can_access_candidate(candidate_id))
  );

-- The candidate path. Both halves matter: own candidate id AND published.
create policy marketing_activities_select_own on public.marketing_activities
  for select to authenticated
  using (
    candidate_id = (select util.own_candidate_id())
    and visibility = 'candidate_visible'
  );

create policy marketing_activities_insert on public.marketing_activities
  for insert to authenticated
  with check (
    (select util.is_internal())
    and (select util.has_permission('activity.create'))
    and (select util.can_access_candidate(candidate_id))
    and (select util.in_business_unit(business_unit_id))
  );

create policy marketing_activities_update on public.marketing_activities
  for update to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('activity.create'))
    and (select util.can_access_candidate(candidate_id))
  )
  with check (
    (select util.is_internal())
    and (select util.can_access_candidate(candidate_id))
  );

-- ---------------------------------------------------------------------------
-- Privileges. `anon` continues to hold nothing anywhere.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.applications to authenticated;
grant select, insert, update on public.marketing_activities to authenticated;
grant select on public.application_status_history to authenticated;

grant all on public.applications, public.marketing_activities,
             public.application_status_history to service_role;

revoke all on public.applications, public.marketing_activities,
              public.application_status_history from anon;
