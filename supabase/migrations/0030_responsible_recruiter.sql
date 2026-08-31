-- ===========================================================================
-- 0030 — Ownership and attribution hardening
--
-- THE PROBLEM
--
-- Until now the daily report answered "how many applications did this person
-- TYPE today". That is only accidentally the same question as "how much
-- marketing work is this person accountable for today", and the two come apart
-- the moment anything but the owning recruiter creates a record:
--
--   * a manager records an application on a recruiter's behalf
--   * a coordinator enters a batch after a handover
--   * and, shortly, an automated pipeline creates records with no human actor
--     at all
--
-- In every one of those cases the work belongs to the candidate's recruiter and
-- the keystrokes belong to somebody else. Counting keystrokes makes the
-- recruiter's own report understate their day, and makes the creator's report
-- overstate theirs.
--
-- THE MODEL
--
-- Two independent facts, never conflated:
--
--   PROVENANCE — created_by, source_type, source_reference.
--                Who or what produced this row. Unchanged by this migration,
--                and nothing here writes to those columns.
--
--   OWNERSHIP  — responsible_recruiter_id.
--                Who was accountable for this candidate's marketing when the
--                event happened.
--
-- WHY A STORED COLUMN RATHER THAN A JOIN
--
-- candidate_assignments remains the canonical ownership model; this column is
-- a materialisation of it, resolved at insert time and then left alone.
--
-- Deriving it live at query time was the first design and was rejected: a
-- reassignment would retroactively move every historical record to the new
-- recruiter, silently rewriting last month's figures and contradicting the
-- rule that history is not edited in place. Reporting has to answer "who was
-- responsible when this happened", and only a stored value can.
--
-- The column is never accepted from a caller. A BEFORE INSERT trigger
-- overwrites whatever arrives with the value derived from the assignment
-- history, so no client — recruiter, portal, or future pipeline — can attribute
-- work to somebody else.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The derivation, in one place.
--
-- Two steps, both reading real assignment history; neither invents anything:
--
--   1. The primary recruiter assigned on the date the event happened.
--   2. Failing that, the primary recruiter assigned on the date the record was
--      created — the case where a recruiter enters back-dated work for a
--      candidate they picked up afterwards.
--
-- If neither resolves, the answer is NULL. An unattributed record is a fact
-- worth seeing; a guessed one is not.
--
-- SECURITY DEFINER because a trigger must resolve ownership even when the
-- caller cannot read the assignment row — a manager creating a record for a
-- candidate they do not personally hold, or a background job with no session
-- at all. It returns a single uuid and reads nothing else.
-- ---------------------------------------------------------------------------
create or replace function util.responsible_recruiter(
  p_candidate_id uuid,
  p_event_on     date,
  p_fallback_on  date default null
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select ca.user_id
      from public.candidate_assignments ca
      where ca.candidate_id = p_candidate_id
        and ca.assignment_type = 'primary_recruiter'
        and ca.starts_on <= p_event_on
        and (ca.ends_on is null or ca.ends_on >= p_event_on)
      -- A transfer closes the outgoing row and opens the incoming one on the
      -- same day, so both match. The still-active one wins, then the later
      -- start: on the day of a handover the work belongs to whoever picked it
      -- up.
      order by (ca.ends_on is null) desc, ca.starts_on desc, ca.created_at desc
      limit 1
    ),
    (
      select ca.user_id
      from public.candidate_assignments ca
      where p_fallback_on is not null
        and ca.candidate_id = p_candidate_id
        and ca.assignment_type = 'primary_recruiter'
        and ca.starts_on <= p_fallback_on
        and (ca.ends_on is null or ca.ends_on >= p_fallback_on)
      order by (ca.ends_on is null) desc, ca.starts_on desc, ca.created_at desc
      limit 1
    )
  )
$$;

revoke all on function util.responsible_recruiter(uuid, date, date) from public, anon;
grant execute on function util.responsible_recruiter(uuid, date, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Columns.
--
-- Nullable on purpose. A record whose candidate had no primary recruiter at
-- the time genuinely has no responsible recruiter, and the schema should be
-- able to say so.
-- ---------------------------------------------------------------------------
alter table public.applications
  add column responsible_recruiter_id uuid references public.users(id);
alter table public.marketing_activities
  add column responsible_recruiter_id uuid references public.users(id);
alter table public.interviews
  add column responsible_recruiter_id uuid references public.users(id);
alter table public.assessments
  add column responsible_recruiter_id uuid references public.users(id);

comment on column public.applications.responsible_recruiter_id is
  'Who was accountable for this candidate when the application was recorded. '
  'Derived from candidate_assignments by trigger; never accepted from a caller. '
  'Not the same as created_by, which is provenance.';
comment on column public.marketing_activities.responsible_recruiter_id is
  'Ownership at event time. See applications.responsible_recruiter_id.';
comment on column public.interviews.responsible_recruiter_id is
  'Ownership at event time. See applications.responsible_recruiter_id.';
comment on column public.assessments.responsible_recruiter_id is
  'Ownership at event time. See applications.responsible_recruiter_id.';

-- ---------------------------------------------------------------------------
-- The guard.
--
-- On INSERT the value is derived and any supplied value is discarded — this is
-- what makes "a recruiter cannot attribute work to themselves" structural
-- rather than a matter of which columns the API happens to expose.
--
-- On UPDATE the value is left alone. Ownership is a fact about when the event
-- happened, so editing the record later must not move it; correcting a genuine
-- mistake needs candidate.assign, which recruiters do not hold.
--
-- The date column differs per table, so it arrives as a trigger argument.
-- ---------------------------------------------------------------------------
create or replace function util.tg_set_responsible_recruiter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date_column text := tg_argv[0];
  v_raw         text;
  v_event_on    date;
begin
  if tg_op = 'UPDATE' then
    if new.responsible_recruiter_id is distinct from old.responsible_recruiter_id then
      -- A migration or background correction with no session actor is not a
      -- user reattributing their own work.
      if auth.uid() is not null and not util.has_permission('candidate.assign') then
        raise exception 'the responsible recruiter can only be changed by someone who can assign candidates'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  v_raw := to_jsonb(new) ->> v_date_column;
  v_event_on := coalesce(v_raw::timestamptz::date, current_date);

  new.responsible_recruiter_id := util.responsible_recruiter(
    new.candidate_id, v_event_on, current_date);

  return new;
end;
$$;

grant execute on function util.tg_set_responsible_recruiter() to authenticated, service_role;

create trigger set_responsible_recruiter
  before insert or update on public.applications
  for each row execute function util.tg_set_responsible_recruiter('application_date');

create trigger set_responsible_recruiter
  before insert or update on public.marketing_activities
  for each row execute function util.tg_set_responsible_recruiter('activity_date');

create trigger set_responsible_recruiter
  before insert or update on public.interviews
  for each row execute function util.tg_set_responsible_recruiter('scheduled_at');

create trigger set_responsible_recruiter
  before insert or update on public.assessments
  for each row execute function util.tg_set_responsible_recruiter('received_at');

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- Every daily report figure is now "this recruiter, this day", so each of the
-- four tables gets the composite that answers exactly that. The date halves
-- are stored values rather than expressions, because the rewritten metrics
-- function below compares against a half-open range instead of casting each
-- row (`at time zone` on a text zone is STABLE, so the cast could not be
-- indexed anyway).
-- ---------------------------------------------------------------------------
create index applications_responsible_idx
  on public.applications (responsible_recruiter_id, application_date);

create index marketing_activities_responsible_idx
  on public.marketing_activities (responsible_recruiter_id, activity_type, activity_date);

create index interviews_responsible_idx
  on public.interviews (responsible_recruiter_id, scheduled_at);

create index assessments_responsible_idx
  on public.assessments (responsible_recruiter_id, received_at);

-- ---------------------------------------------------------------------------
-- Backfill.
--
-- Forward-only and deterministic: every value comes from the assignment
-- history, resolved at the record's own business date with the creation date
-- as the fallback. Rows the history cannot answer for are left NULL rather
-- than being attributed to their creator — inferring ownership from
-- created_by is the exact conflation this migration exists to undo.
--
-- The trigger is BEFORE UPDATE and returns NEW unchanged for updates, so it
-- does not fight the backfill. The audit trigger records these as ordinary
-- updates with no session actor, which is accurate: a migration did them.
-- ---------------------------------------------------------------------------
update public.applications a
   set responsible_recruiter_id =
       util.responsible_recruiter(a.candidate_id, a.application_date, a.created_at::date);

update public.marketing_activities m
   set responsible_recruiter_id =
       util.responsible_recruiter(m.candidate_id,
                                  (m.activity_date at time zone 'UTC')::date,
                                  m.created_at::date);

update public.interviews i
   set responsible_recruiter_id =
       util.responsible_recruiter(i.candidate_id,
                                  coalesce((i.scheduled_at at time zone 'UTC')::date,
                                           i.created_at::date),
                                  i.created_at::date);

update public.assessments s
   set responsible_recruiter_id =
       util.responsible_recruiter(s.candidate_id,
                                  (s.received_at at time zone 'UTC')::date,
                                  s.created_at::date);

-- Say out loud how much could not be attributed, rather than letting it be
-- discovered later as a report that looks quietly low.
do $$
declare
  v_apps bigint; v_acts bigint; v_ints bigint; v_ass bigint;
begin
  select count(*) into v_apps from public.applications where responsible_recruiter_id is null;
  select count(*) into v_acts from public.marketing_activities where responsible_recruiter_id is null;
  select count(*) into v_ints from public.interviews where responsible_recruiter_id is null;
  select count(*) into v_ass  from public.assessments where responsible_recruiter_id is null;

  if v_apps + v_acts + v_ints + v_ass > 0 then
    raise notice
      'Unattributed after backfill — applications: %, activities: %, interviews: %, assessments: %. '
      'These candidates had no primary recruiter assigned at the time. Assign one and re-run the '
      'backfill for those rows if the history is known; do not guess.',
      v_apps, v_acts, v_ints, v_ass;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The metrics, re-pointed at ownership.
--
-- Same five figures, same shape, same "counted from records, never typed"
-- guarantee. The only change is which column decides whose day a record
-- belongs to — and that is the whole point of this migration.
--
-- The date predicates are now half-open ranges rather than a per-row cast, so
-- each count is an index range scan on the composite indexes above instead of
-- a sequential scan with a STABLE function call per row.
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
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select (p_report_date::timestamp at time zone 'UTC')             as day_start,
           ((p_report_date + 1)::timestamp at time zone 'UTC')       as day_end
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

revoke all on function public.daily_report_metrics(uuid, date) from public, anon;
grant execute on function public.daily_report_metrics(uuid, date) to authenticated, service_role;
