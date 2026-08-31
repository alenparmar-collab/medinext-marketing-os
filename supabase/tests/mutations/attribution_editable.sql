-- ---------------------------------------------------------------------------
-- MUTATION: let anyone edit ownership after the fact.
--
-- Ownership is a fact about when the event happened. A recruiter who can edit
-- it can move another recruiter's completed work onto their own report.
-- ---------------------------------------------------------------------------
create or replace function util.tg_set_responsible_recruiter()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_date_column text := tg_argv[0];
  v_raw text;
  v_event_on date;
begin
  if tg_op = 'UPDATE' then
    return new;   -- no guard at all
  end if;

  v_raw := to_jsonb(new) ->> v_date_column;
  v_event_on := coalesce(v_raw::timestamptz::date, current_date);
  new.responsible_recruiter_id := util.responsible_recruiter(
    new.candidate_id, v_event_on, current_date);
  return new;
end;
$$;
