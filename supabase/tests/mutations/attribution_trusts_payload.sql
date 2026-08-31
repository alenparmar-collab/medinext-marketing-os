-- ---------------------------------------------------------------------------
-- MUTATION: believe the caller about who owns the work.
--
-- Derives ownership only when the payload did not supply it — which is how
-- this kind of column is usually written, and which lets any client attribute
-- work to whoever it likes.
-- ---------------------------------------------------------------------------
create or replace function util.tg_set_responsible_recruiter()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_date_column text := tg_argv[0];
  v_raw text;
  v_event_on date;
begin
  if tg_op = 'UPDATE' then
    return new;
  end if;

  v_raw := to_jsonb(new) ->> v_date_column;
  v_event_on := coalesce(v_raw::timestamptz::date, current_date);

  new.responsible_recruiter_id := coalesce(
    new.responsible_recruiter_id,
    util.responsible_recruiter(new.candidate_id, v_event_on, current_date));

  return new;
end;
$$;
