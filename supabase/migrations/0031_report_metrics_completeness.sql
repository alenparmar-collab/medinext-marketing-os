-- ===========================================================================
-- 0031 — A recruiter's own figures survive a handover
--
-- THE DEFECT
--
-- 0030 made the daily report count what a recruiter is responsible for. But
-- the function is SECURITY INVOKER, so its counts are filtered by the caller's
-- RLS — and access to a candidate follows the ACTIVE assignment. The moment a
-- candidate is handed to somebody else, the previous recruiter stops being able
-- to read that candidate's records, and their own historical figures silently
-- fall to zero:
--
--   as an administrator:      applications = 1
--   as the recruiter himself: applications = 0
--
-- Both numbers are about the same day and the same person's work. The second
-- one is wrong, and it is wrong in the direction that makes a report look like
-- somebody did less than they did.
--
-- This is not new to 0030 — the same thing happened when the figures were
-- counted by created_by — but 0030 is what puts these numbers in front of
-- people as a measure of their work, so it has to be right.
--
-- THE FIX
--
-- SECURITY DEFINER, with the authorization done explicitly and narrowly:
--
--   * your own figures — always;
--   * somebody else's — only with report.view_all, and only inside your
--     business unit;
--   * anything else — refused, loudly.
--
-- That is deliberately the same rule as the SELECT policies on daily_reports,
-- so the figures and the report they belong to are visible to exactly the same
-- people. A refusal is also an improvement on what came before: calling this
-- for a recruiter you were not entitled to see used to return a silently
-- filtered partial count, which looks like an answer.
--
-- The function still only counts. It writes nothing, and it remains the single
-- definition of what each figure means.
-- ===========================================================================

create or replace function public.daily_report_metrics(
  p_recruiter_id uuid,
  p_report_date  date
)
returns table (
  applications        bigint,
  recruiter_responses bigint,
  interviews          bigint,
  assessments         bigint,
  rejections          bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_unit   uuid;
begin
  -- A migration, seed or background job has no session actor. It is already
  -- running with more authority than this function grants.
  if v_caller is not null and v_caller <> p_recruiter_id then
    select u.business_unit_id into v_unit
      from public.users u where u.id = p_recruiter_id;

    if not (util.has_permission('report.view_all') and util.in_business_unit(v_unit)) then
      raise exception 'not permitted to read another user''s figures'
        using errcode = '42501';
    end if;
  end if;

  return query
  with bounds as (
    select (p_report_date::timestamp at time zone 'UTC')       as day_start,
           ((p_report_date + 1)::timestamp at time zone 'UTC') as day_end
  )
  select
    (select count(*) from public.applications a
      where a.responsible_recruiter_id = p_recruiter_id
        and a.application_date = p_report_date),

    (select count(*) from public.marketing_activities m, bounds b
      where m.responsible_recruiter_id = p_recruiter_id
        and m.activity_type = 'recruiter_response'
        and m.activity_date >= b.day_start and m.activity_date < b.day_end),

    (select count(*) from public.interviews i, bounds b
      where i.responsible_recruiter_id = p_recruiter_id
        and i.scheduled_at >= b.day_start and i.scheduled_at < b.day_end),

    (select count(*) from public.assessments s, bounds b
      where s.responsible_recruiter_id = p_recruiter_id
        and s.received_at >= b.day_start and s.received_at < b.day_end),

    (select count(*) from public.marketing_activities m, bounds b
      where m.responsible_recruiter_id = p_recruiter_id
        and m.activity_type = 'rejection'
        and m.activity_date >= b.day_start and m.activity_date < b.day_end);
end;
$$;

revoke all on function public.daily_report_metrics(uuid, date) from public, anon;
grant execute on function public.daily_report_metrics(uuid, date) to authenticated, service_role;
