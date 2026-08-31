-- MUTATION PROBE: let any internal user read every daily report.
--
-- Removes the ownership predicate, so a recruiter would see colleagues'
-- reports. The suite must notice.
drop policy daily_reports_select_own on public.daily_reports;
create policy daily_reports_select_own on public.daily_reports
  for select to authenticated
  using ((select util.is_internal()));
