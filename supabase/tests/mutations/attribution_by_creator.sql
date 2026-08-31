-- ---------------------------------------------------------------------------
-- MUTATION: put the daily report back on keystrokes.
--
-- This is the exact behaviour Build 5.1 removed. If the suite still passes,
-- it is not actually checking that reports follow responsibility.
-- ---------------------------------------------------------------------------
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
language sql stable security invoker set search_path = public
as $$
  select
    (select count(*) from public.applications a
      where a.created_by = p_recruiter_id and a.application_date = p_report_date),
    (select count(*) from public.marketing_activities m
      where m.created_by = p_recruiter_id and m.activity_type = 'recruiter_response'
        and (m.activity_date at time zone 'UTC')::date = p_report_date),
    (select count(*) from public.interviews i
      where i.created_by = p_recruiter_id
        and (i.scheduled_at at time zone 'UTC')::date = p_report_date),
    (select count(*) from public.assessments s
      where s.created_by = p_recruiter_id
        and (s.received_at at time zone 'UTC')::date = p_report_date),
    (select count(*) from public.marketing_activities m
      where m.created_by = p_recruiter_id and m.activity_type = 'rejection'
        and (m.activity_date at time zone 'UTC')::date = p_report_date)
$$;
