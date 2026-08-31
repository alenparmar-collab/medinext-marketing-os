-- ---------------------------------------------------------------------------
-- MUTATION: resolve ownership as of today rather than as of the event.
--
-- This is the design that was rejected: a reassignment silently moves every
-- historical record to the new recruiter and rewrites last month's figures.
-- ---------------------------------------------------------------------------
create or replace function util.responsible_recruiter(
  p_candidate_id uuid,
  p_event_on     date,
  p_fallback_on  date default null
)
returns uuid language sql stable security definer set search_path = '' as $$
  select ca.user_id
  from public.candidate_assignments ca
  where ca.candidate_id = p_candidate_id
    and ca.assignment_type = 'primary_recruiter'
    and ca.ends_on is null
  order by ca.starts_on desc
  limit 1
$$;

-- Re-derive, as a deployment of this version would.
update public.applications a
   set responsible_recruiter_id = util.responsible_recruiter(a.candidate_id, a.application_date);
