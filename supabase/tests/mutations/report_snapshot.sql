-- MUTATION PROBE: make confirmation store typed numbers instead of derived ones.
--
-- This is the guarantee the whole daily-report design rests on: the figures come
-- from the records, never from input. Breaking it must be caught.
create or replace function public.confirm_daily_report(
  p_report_id uuid,
  p_notes        text default null,
  p_observations text default null,
  p_exceptions   text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  update public.daily_reports
     set status = 'confirmed',
         notes        = coalesce(p_notes, notes),
         observations = coalesce(p_observations, observations),
         exceptions   = coalesce(p_exceptions, exceptions),
         -- Deliberately wrong: a fixed number rather than a derived one.
         snapshot_applications        = 99,
         snapshot_recruiter_responses = 99,
         snapshot_interviews          = 99,
         snapshot_assessments         = 99,
         snapshot_rejections          = 99,
         snapshot_taken_at            = now(),
         confirmed_by = util.current_actor_id(),
         confirmed_at = now()
   where id = p_report_id and status = 'draft';

  return p_report_id;
end;
$fn$;
