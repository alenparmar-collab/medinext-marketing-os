-- ===========================================================================
-- DEMO SEED, part 5 — daily reports, review queue, assignment history
--
-- DEVELOPMENT AND DEMO ONLY. Every person is fictional.
--
-- Note what this file does NOT insert: the snapshot figures on the confirmed
-- report, and every review item. Those come from confirm_daily_report() and
-- run_review_checks() respectively, exercised below. Seeding them by hand would
-- prove nothing about whether the derivation works.
--
-- Shape chosen so each Build 5 guarantee is falsifiable:
--   * Reports for TWO recruiters across SEVERAL dates, so "a recruiter sees
--     only their own" and the date filters can fail.
--   * One confirmed and one draft, so the snapshot/live distinction can fail.
--   * An assignment that is ended and reassigned, so history can fail.
-- ===========================================================================

select set_config('app.source', 'seed', false);

-- ---------------------------------------------------------------------------
-- Reassignment: Dmitri moves from Halvorsen to Salas.
--
-- Performed as a real end-and-create rather than an UPDATE of user_id, because
-- assignments are a history: "who owned this candidate in August" must stay
-- answerable.
-- ---------------------------------------------------------------------------
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000002', false);

update public.candidate_assignments
   set ends_on = current_date - 2,
       ended_by = '00000000-0000-4000-8000-000000000002'
 where candidate_id = '00000000-0000-4000-a000-000000000004'
   and user_id = '00000000-0000-4000-8000-000000000004'
   and ends_on is null;

insert into public.candidate_assignments
  (id, business_unit_id, candidate_id, user_id, assignment_type, starts_on, created_by)
values
  ('00000000-0000-4000-b000-000000000007', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-8000-000000000003',
   'primary_recruiter', current_date - 2, '00000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A day's work for Salas, dated onto the report days.
--
-- The point of the daily report is that these records ARE the figures. Seeding
-- them explicitly on the report dates is what lets the suite assert that the
-- count matches the rows rather than matching another hard-coded number.
-- ---------------------------------------------------------------------------
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000003', false);

insert into public.applications (
  id, business_unit_id, candidate_id, marketing_period_id,
  company_name, position_title, job_id, job_location,
  application_date, status, source_type, verified_at, verified_by, created_by
)
select
  ('00000000-0000-4000-8f00-0000000001' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-8c00-000000000001',
  company, role_title, 'REF-' || lpad(n::text, 4, '0'), 'United Kingdom',
  current_date - offset_days, 'submitted',
  'manual', now(), '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000003'
from (values
  (1, 'Pennine Clinical Research', 'Clinical Data Coordinator', 3),
  (2, 'Thameside Biometrics',      'Data Manager',              3),
  (3, 'Calder Trials Group',       'CDM Analyst',               3),
  (4, 'Ravenswood Pharma',         'Clinical Programmer',       3),
  (5, 'Whitfield Clinical',        'Senior Data Manager',       2),
  (6, 'Ashbourne Research',        'Clinical Data Lead',        2),
  (7, 'Ellesmere Life Sciences',   'CDISC Analyst',             2)
) as t(n, company, role_title, offset_days)
on conflict (id) do nothing;

-- Recruiter responses and a rejection, dated onto the same days.
insert into public.marketing_activities (
  id, business_unit_id, candidate_id, application_id, marketing_period_id,
  activity_type, activity_date, summary, details,
  source_type, verified_at, verified_by, created_by
) values
  ('00000000-0000-4000-9100-000000000101', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000101',
   '00000000-0000-4000-8c00-000000000001',
   'recruiter_response', (current_date - 3)::timestamptz + interval '11 hours',
   'Pennine Clinical Research recruiter replied',
   '{"company_name":"Pennine Clinical Research"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-9100-000000000102', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000102',
   '00000000-0000-4000-8c00-000000000001',
   'recruiter_response', (current_date - 3)::timestamptz + interval '15 hours',
   'Thameside Biometrics recruiter replied',
   '{"company_name":"Thameside Biometrics"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-9100-000000000103', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000103',
   '00000000-0000-4000-8c00-000000000001',
   'rejection', (current_date - 2)::timestamptz + interval '10 hours',
   'Calder Trials Group rejected at CV stage',
   '{"company_name":"Calder Trials Group","stage":"submission"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Records where the CREATOR is not the OWNER.
--
-- Everything above was created by the recruiter who owns the candidate, so it
-- cannot tell the two apart. These three can: each belongs to Salas's day
-- because Salas is Priya's primary recruiter, and none of them was typed by
-- him. Without these the report figures would be identical whether they were
-- attributed by ownership or by keystrokes, and the test asserting the
-- difference would be vacuous.
--
-- "SYSTEM" here is created_by = NULL — the existing representation for a write
-- with no session actor, which the audit trigger already records as
-- actor_kind = 'system'. No fake user row is invented for it.
-- ---------------------------------------------------------------------------

-- CASE C — a manager records an application on the recruiter's behalf.
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000002', false);

insert into public.applications (
  id, business_unit_id, candidate_id, marketing_period_id,
  company_name, position_title, job_id, job_location,
  application_date, status, source_type, verified_at, verified_by, created_by
) values (
  '00000000-0000-4000-8f00-000000000108', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8c00-000000000001',
  'Marlowe Clinical Partners', 'Clinical Data Manager', 'REF-0108', 'United Kingdom',
  current_date - 3, 'submitted',
  'manual', now(), '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

-- CASE A — an automated pipeline records an application. No session actor.
select set_config('app.actor_id', '', false);

insert into public.applications (
  id, business_unit_id, candidate_id, marketing_period_id,
  company_name, position_title, job_id, job_location,
  application_date, status, source_type, source_reference, created_by
) values (
  '00000000-0000-4000-8f00-000000000109', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8c00-000000000001',
  'Harrowgate Biosciences', 'Data Standards Analyst', 'REF-0109', 'United Kingdom',
  current_date - 3, 'submitted',
  'system', 'pipeline:demo:application:0109', null
) on conflict (id) do nothing;

-- CASE B — an interview arrives from an email, with no human actor at all.
-- Left as `completed` so it does not also trip the past-due review check; this
-- record is here to prove attribution, not to exercise the queue.
insert into public.interviews (
  id, business_unit_id, candidate_id, application_id,
  interview_round, scheduled_at, time_zone, status,
  source_type, source_reference, created_by
) values (
  '00000000-0000-4000-9200-000000000021', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000101',
  1, (current_date - 3)::timestamptz + interval '14 hours', 'Europe/London', 'completed',
  'email_event', 'message-id:<demo-0021@example.invalid>', null
) on conflict (id) do nothing;

select set_config('app.actor_id', '00000000-0000-4000-8000-000000000003', false);

-- ---------------------------------------------------------------------------
-- Daily reports.
--
-- Only the user-entered fields are seeded. The figures are derived on read, and
-- frozen onto the confirmed one by the function below.
-- ---------------------------------------------------------------------------
insert into public.daily_reports (
  id, business_unit_id, recruiter_id, report_date, status, notes, observations, exceptions
) values
  -- Salas, three days back — confirmed below.
  ('00000000-0000-4000-9500-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-8000-000000000003', current_date - 3, 'draft',
   'Steady day. Focused on the Northwind and Halcyon pipelines.',
   'Northwind are moving faster than usual — second round already booked.',
   null),

  -- Salas, two days back — confirmed below, with a discrepancy noted.
  ('00000000-0000-4000-9500-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-8000-000000000003', current_date - 2, 'draft',
   'Chased three vendors for updates.',
   null,
   'Spoke to two more recruiters by phone; no application record exists for those, so the count below is lower than the day felt.'),

  -- Salas, yesterday — left as a DRAFT on purpose, so the UI has both states.
  ('00000000-0000-4000-9500-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-8000-000000000003', current_date - 1, 'draft',
   'Quiet day, mostly follow-ups.',
   null, null),

  -- Halvorsen, two days back.
  ('00000000-0000-4000-9500-000000000004', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-8000-000000000004', current_date - 2, 'draft',
   'Shannon Safety offer expected in writing.',
   'Lucia is close to an offer; worth pausing new submissions.',
   null),

  -- Rossi, other business unit — proves cross-tenant isolation on reports.
  ('00000000-0000-4000-9500-000000000005', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-8000-000000000005', current_date - 2, 'draft',
   'Kansai screening call completed.',
   null, null)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Confirm two of them THROUGH THE FUNCTION, so the snapshot is genuinely
-- derived. A hand-written snapshot would tell us nothing.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('app.actor_id', '00000000-0000-4000-8000-000000000003', true);
  perform public.confirm_daily_report('00000000-0000-4000-9500-000000000001');
  perform public.confirm_daily_report('00000000-0000-4000-9500-000000000002');

  perform set_config('app.actor_id', '00000000-0000-4000-8000-000000000004', true);
  perform public.confirm_daily_report('00000000-0000-4000-9500-000000000004');
end;
$$;

-- ---------------------------------------------------------------------------
-- Review queue: generated by the checks, not seeded.
--
-- Running this twice is deliberate — it proves the dedupe key converges rather
-- than accumulating, which is what will make a scheduled job safe later.
-- ---------------------------------------------------------------------------
do $$
declare v_first integer; v_second integer;
begin
  v_first  := public.run_review_checks('00000000-0000-4000-9000-000000000001');
  v_second := public.run_review_checks('00000000-0000-4000-9000-000000000001');

  if v_first <> v_second then
    raise exception 'review checks are not idempotent: % then %', v_first, v_second;
  end if;

  perform public.run_review_checks('00000000-0000-4000-9000-000000000002');
end;
$$;

-- Give one item a reviewer and one a resolution, so the queue has every state.
update public.review_items
   set status = 'in_review',
       assigned_to = '00000000-0000-4000-8000-000000000002'
 where dedupe_key like 'candidate:%:unassigned'
   and business_unit_id = '00000000-0000-4000-9000-000000000001';

update public.review_items
   set status = 'resolved',
       resolution = 'no_action_needed',
       resolution_notes = 'Vendor never issued a reference for this role. Confirmed with the recruiter.',
       resolved_by = '00000000-0000-4000-8000-000000000002',
       resolved_at = now()
 where dedupe_key like 'application:%:no_reference'
   and business_unit_id = '00000000-0000-4000-9000-000000000001'
   and id = (
     select id from public.review_items
     where dedupe_key like 'application:%:no_reference'
       and business_unit_id = '00000000-0000-4000-9000-000000000001'
     order by created_at limit 1
   );

select set_config('app.actor_id', '', false);
select set_config('app.source', '', false);
