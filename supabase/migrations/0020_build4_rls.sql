-- ===========================================================================
-- 0020 — Row Level Security for interviews, assessments and notifications
--
-- Same shape as 0009 and 0014: RLS enabled AND forced, per-command policies,
-- helper calls wrapped as (select util.fn()) for per-statement evaluation, and
-- the tenant gate inherited through util.can_access_candidate().
-- ===========================================================================

alter table public.interviews                 enable row level security;
alter table public.interview_schedule_history enable row level security;
alter table public.assessments                enable row level security;
alter table public.notifications              enable row level security;

alter table public.interviews                 force row level security;
alter table public.interview_schedule_history force row level security;
alter table public.assessments                force row level security;
alter table public.notifications              force row level security;

-- ---------------------------------------------------------------------------
-- Interviews
-- ---------------------------------------------------------------------------
create policy interviews_select_internal on public.interviews
  for select to authenticated
  using ((select util.can_access_candidate(candidate_id)));

-- The candidate reads their own. Note what is NOT hidden by this policy:
-- `notes` is on the row, so a candidate who can read the row can read it.
-- Internal commentary about an interview therefore goes in
-- candidate_internal_notes or a note activity, never in interviews.notes.
create policy interviews_select_own on public.interviews
  for select to authenticated
  using (candidate_id = (select util.own_candidate_id()));

create policy interviews_insert on public.interviews
  for insert to authenticated
  with check (
    (select util.is_internal())
    and (select util.has_permission('interview.manage'))
    and (select util.can_access_candidate(candidate_id))
    and (select util.in_business_unit(business_unit_id))
  );

create policy interviews_update on public.interviews
  for update to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('interview.manage'))
    and (select util.can_access_candidate(candidate_id))
  )
  with check (
    (select util.is_internal())
    and (select util.can_access_candidate(candidate_id))
  );

create policy interviews_delete on public.interviews
  for delete to authenticated
  using (
    (select util.has_permission('interview.delete'))
    and (select util.can_access_candidate(candidate_id))
  );

-- ---------------------------------------------------------------------------
-- Schedule history.
--
-- Readable with the interview by internal staff. No candidate policy: the
-- portal shows the current schedule, not who moved it and why.
--
-- INSERT is permitted only in the context the trigger runs in; there is no
-- UPDATE or DELETE policy at all, so history accumulates and is never edited.
-- ---------------------------------------------------------------------------
create policy interview_schedule_history_select on public.interview_schedule_history
  for select to authenticated
  using (
    (select util.is_internal())
    and exists (
      select 1 from public.interviews i
      where i.id = interview_schedule_history.interview_id
        and (select util.can_access_candidate(i.candidate_id))
    )
  );

create policy interview_schedule_history_insert on public.interview_schedule_history
  for insert to authenticated
  with check (
    (select util.is_internal())
    and exists (
      select 1 from public.interviews i
      where i.id = interview_schedule_history.interview_id
        and (select util.can_access_candidate(i.candidate_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Assessments
-- ---------------------------------------------------------------------------
create policy assessments_select_internal on public.assessments
  for select to authenticated
  using ((select util.can_access_candidate(candidate_id)));

create policy assessments_select_own on public.assessments
  for select to authenticated
  using (candidate_id = (select util.own_candidate_id()));

create policy assessments_insert on public.assessments
  for insert to authenticated
  with check (
    (select util.is_internal())
    and (select util.has_permission('assessment.manage'))
    and (select util.can_access_candidate(candidate_id))
    and (select util.in_business_unit(business_unit_id))
  );

create policy assessments_update on public.assessments
  for update to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('assessment.manage'))
    and (select util.can_access_candidate(candidate_id))
  )
  with check (
    (select util.is_internal())
    and (select util.can_access_candidate(candidate_id))
  );

create policy assessments_delete on public.assessments
  for delete to authenticated
  using (
    (select util.has_permission('assessment.delete'))
    and (select util.can_access_candidate(candidate_id))
  );

-- ---------------------------------------------------------------------------
-- Notifications
--
-- Everyone reads their own and nobody else's — the same rule for a candidate
-- and for an administrator. There is deliberately no "view all notifications"
-- permission: a notification is addressed correspondence, and an admin who
-- needs to know what was sent has the audit log.
--
-- There is NO insert policy for `authenticated`. Notifications are created
-- exclusively by util.emit_notification, which is SECURITY DEFINER, so a
-- candidate cannot generate system notifications for themselves or anyone else.
-- ---------------------------------------------------------------------------
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

-- The only thing a recipient may change is whether they have read it.
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privileges. `anon` continues to hold nothing anywhere.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.interviews  to authenticated;
grant select, insert, update, delete on public.assessments to authenticated;
grant select, insert on public.interview_schedule_history  to authenticated;
grant select, update on public.notifications               to authenticated;

grant all on public.interviews, public.assessments,
             public.interview_schedule_history, public.notifications
  to service_role;

revoke all on public.interviews, public.assessments,
              public.interview_schedule_history, public.notifications
  from anon;
