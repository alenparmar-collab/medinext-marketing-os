-- ===========================================================================
-- 0025 — RLS for daily reports and the review queue
--
-- Both are INTERNAL-ONLY surfaces. Neither has a candidate policy of any kind,
-- so a portal user querying either table receives zero rows rather than an
-- error — which is also the right behaviour for not leaking existence.
--
-- Same conventions as every previous build: enabled AND forced, per-command
-- policies, helper calls wrapped as (select util.fn()).
-- ===========================================================================

alter table public.daily_reports enable row level security;
alter table public.review_items  enable row level security;
alter table public.daily_reports force row level security;
alter table public.review_items  force row level security;

-- ---------------------------------------------------------------------------
-- Daily reports
--
-- A recruiter reads and writes their own. Managers and admins read the whole
-- unit — that is the point of report.view_all.
--
-- Note the internal check on every policy: without it, a candidate whose user
-- id happened to appear as a recruiter_id would match `recruiter_id = auth.uid()`.
-- That cannot happen today, but the check costs nothing and removes the
-- question entirely.
-- ---------------------------------------------------------------------------
create policy daily_reports_select_own on public.daily_reports
  for select to authenticated
  using ((select util.is_internal()) and recruiter_id = (select auth.uid()));

create policy daily_reports_select_all on public.daily_reports
  for select to authenticated
  using (
    (select util.has_permission('report.view_all'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy daily_reports_insert_own on public.daily_reports
  for insert to authenticated
  with check (
    (select util.is_internal())
    and (select util.has_permission('report.submit_own'))
    and recruiter_id = (select auth.uid())
    and (select util.in_business_unit(business_unit_id))
  );

-- A confirmed report is a historical reconciliation record. The `status = 'draft'`
-- predicate in USING makes "a confirmed report cannot be edited" a database
-- invariant rather than a UI convention; confirmation itself goes through the
-- SECURITY DEFINER function in 0026.
create policy daily_reports_update_own_draft on public.daily_reports
  for update to authenticated
  using (
    (select util.is_internal())
    and recruiter_id = (select auth.uid())
    and status = 'draft'
  )
  with check (
    recruiter_id = (select auth.uid())
    and status = 'draft'
  );

-- No DELETE policy at all. Reports accumulate.

-- ---------------------------------------------------------------------------
-- Review queue — internal only, unit-scoped.
--
-- Items are readable by any internal user in the unit rather than only the
-- assignee: a queue nobody can see is a queue nobody works.
-- ---------------------------------------------------------------------------
create policy review_items_select on public.review_items
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('review.view'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy review_items_insert on public.review_items
  for insert to authenticated
  with check (
    (select util.is_internal())
    and (select util.has_permission('review.manage'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy review_items_update on public.review_items
  for update to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('review.manage'))
    and (select util.in_business_unit(business_unit_id))
  )
  with check (
    (select util.is_internal())
    and (select util.in_business_unit(business_unit_id))
  );

-- No DELETE policy. Review history is never destroyed; dismissing is a status.

-- ---------------------------------------------------------------------------
-- Privileges. `anon` continues to hold nothing anywhere.
-- ---------------------------------------------------------------------------
grant select, insert, update on public.daily_reports to authenticated;
grant select, insert, update on public.review_items  to authenticated;
grant all on public.daily_reports, public.review_items to service_role;
revoke all on public.daily_reports, public.review_items from anon;
