-- ---------------------------------------------------------------------------
-- MUTATION: let the caller's own row access decide their figures.
--
-- SECURITY INVOKER looks harmless and is how the function was originally
-- written. It means a recruiter who has since handed a candidate on can no
-- longer count the work they did while they held them, and their own report
-- silently shrinks.
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
        and m.activity_date >= b.day_start and m.activity_date < b.day_end)
$$;
