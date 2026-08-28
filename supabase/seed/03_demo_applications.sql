-- ===========================================================================
-- DEMO SEED, part 3 — applications and marketing activity
--
-- DEVELOPMENT AND DEMO ONLY. Every company, role and event below is fictional.
--
-- Shape chosen so the permission model and the aggregation principle are both
-- falsifiable:
--   * Applications spread across several statuses, on candidates belonging to
--     DIFFERENT recruiters, so "recruiter sees only their own applications"
--     can fail.
--   * Applications on candidates in BOTH business units, so cross-tenant
--     isolation on applications can fail.
--   * At least one interview, assessment and rejection activity, so the
--     derived counts have something real to count.
--   * An internal NOTE activity and an internal note row, so "a candidate can
--     never read internal commentary" can fail.
--
-- Note what is NOT inserted here: application_submitted and status_change
-- activities, and every status-history row. Those are produced by the database
-- triggers in 0015. If they are missing after a seed run, the automation is
-- broken — which is exactly what we want the seed to reveal.
-- ===========================================================================

select set_config('app.source', 'seed', false);
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000002', false);

-- ---------------------------------------------------------------------------
-- Applications
--   Priya  (Salas)     — 4 applications, varied statuses
--   Kwame  (Salas)     — 2
--   Lucia  (Halvorsen) — 3
--   Dmitri (Halvorsen) — 1
--   Hiroshi (Rossi, other unit) — 1
--   Naomi  (unassigned) — 1, so a manager sees an application no recruiter can
-- ---------------------------------------------------------------------------
insert into public.applications (
  id, business_unit_id, candidate_id, marketing_period_id,
  company_name, position_title, job_id, job_url, job_location,
  application_date, status, notes, source_type, verified_at, verified_by, created_by
) values
  ('00000000-0000-4000-f000-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001',
   'Northwind Clinical', 'Senior Clinical Data Manager', 'NWC-4417',
   'https://careers.example-northwind.test/jobs/4417', 'London, UK',
   current_date - 50, 'interview', 'Vendor moved quickly after the first call.',
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-f000-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001',
   'Halcyon Life Sciences', 'Clinical Data Lead', 'HLS-201',
   'https://careers.example-halcyon.test/201', 'Remote, UK',
   current_date - 44, 'assessment', null,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-f000-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001',
   'Beacon CRO', 'CDISC Programmer', null, null, 'Reading, UK',
   current_date - 30, 'rejected', 'Rejected at CV stage without a reason given.',
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-f000-000000000004', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-c000-000000000001',
   'Verity Trials', 'Clinical Data Manager', 'VT-8890', null, 'Cambridge, UK',
   current_date - 9, 'submitted', null,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-f000-000000000005', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000002',
   'Aldergate Regulatory', 'Regulatory Affairs Manager', 'ALD-77', null, 'Birmingham, UK',
   current_date - 28, 'recruiter_response', 'Recruiter asked for availability.',
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-f000-000000000006', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-c000-000000000002',
   'Meridian Pharma', 'Senior Regulatory Associate', null, null, 'Manchester, UK',
   current_date - 14, 'screening', null,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-f000-000000000007', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-c000-000000000003',
   'Shannon Safety Group', 'Pharmacovigilance Officer', 'SSG-1204',
   'https://careers.example-shannon.test/1204', 'Dublin, IE',
   current_date - 20, 'offer', 'Offer expected in writing this week.',
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  ('00000000-0000-4000-f000-000000000008', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-c000-000000000003',
   'Liffey Biotech', 'Drug Safety Associate', null, null, 'Cork, IE',
   current_date - 16, 'withdrawn', 'Candidate withdrew — commute.',
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  ('00000000-0000-4000-f000-000000000009', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-c000-000000000003',
   'Grafton Clinical', 'Safety Scientist', null, null, 'Remote, IE',
   current_date - 5, 'submitted', null,
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  ('00000000-0000-4000-f000-00000000000a', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000004', null,
   'Caledonia Analytics', 'Biostatistician', null, null, 'Edinburgh, UK',
   current_date - 3, 'submitted', null,
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  -- On the UNASSIGNED candidate: visible to a manager, invisible to every recruiter.
  ('00000000-0000-4000-f000-00000000000b', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000005', '00000000-0000-4000-c000-000000000004',
   'Avonmouth Medical Communications', 'Medical Writer', null, null, 'Bristol, UK',
   current_date - 60, 'closed', null,
   'manual', now(), '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'),

  -- Other business unit: cross-tenant isolation has something to fail on.
  ('00000000-0000-4000-f000-00000000000c', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-a000-000000000006', '00000000-0000-4000-c000-000000000005',
   'Kansai Clinical Partners', 'Clinical Operations Manager', 'KCP-33', null, 'Osaka, JP',
   current_date - 12, 'screening', null,
   'manual', now(), '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Marketing activity beyond what the triggers generate.
--
-- These are the events a human records because no application row implies them:
-- a recruiter replying, an interview happening, an assessment being issued, a
-- rejection arriving, a follow-up call, and an internal note.
-- ---------------------------------------------------------------------------
insert into public.marketing_activities (
  id, business_unit_id, candidate_id, application_id, marketing_period_id,
  activity_type, activity_date, summary, details,
  source_type, verified_at, verified_by, created_by
) values
  ('00000000-0000-4000-1000-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-f000-000000000001',
   '00000000-0000-4000-c000-000000000001',
   'recruiter_response', now() - interval '47 days',
   'Northwind Clinical recruiter replied',
   '{"company_name":"Northwind Clinical","responder":"D. Whitfield","channel":"phone"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-1000-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-f000-000000000001',
   '00000000-0000-4000-c000-000000000001',
   'interview', now() - interval '40 days',
   'First-round technical interview, Northwind Clinical',
   '{"company_name":"Northwind Clinical","round":1,"mode":"video","outcome":"passed"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-1000-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-f000-000000000002',
   '00000000-0000-4000-c000-000000000001',
   'assessment', now() - interval '35 days',
   'SAS programming assessment issued by Halcyon Life Sciences',
   '{"company_name":"Halcyon Life Sciences","platform":"HackerRank","due_in_days":5}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-1000-000000000004', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-f000-000000000003',
   '00000000-0000-4000-c000-000000000001',
   'rejection', now() - interval '26 days',
   'Beacon CRO rejected at CV stage',
   '{"company_name":"Beacon CRO","stage":"submission"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-1000-000000000005', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', null, '00000000-0000-4000-c000-000000000001',
   'follow_up', now() - interval '6 days',
   'Chased Verity Trials for an update',
   '{"channel":"email"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  -- INTERNAL. The visibility trigger forces notes internal regardless of input.
  -- If this string ever appears in the candidate portal, the RLS suite failed.
  ('00000000-0000-4000-1000-000000000006', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', null, '00000000-0000-4000-c000-000000000001',
   'note', now() - interval '20 days',
   'INTERNAL ONLY — demo activity note. Must never be visible to a candidate.',
   '{"note":"Internal commentary about rate expectations. Not for the candidate."}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-1000-000000000007', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-f000-000000000007',
   '00000000-0000-4000-c000-000000000003',
   'recruiter_response', now() - interval '18 days',
   'Shannon Safety Group recruiter replied',
   '{"company_name":"Shannon Safety Group","responder":"M. Byrne"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  ('00000000-0000-4000-1000-000000000008', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-f000-000000000007',
   '00000000-0000-4000-c000-000000000003',
   'interview', now() - interval '13 days',
   'Panel interview, Shannon Safety Group',
   '{"company_name":"Shannon Safety Group","round":2,"mode":"onsite","outcome":"passed"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  ('00000000-0000-4000-1000-000000000009', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-f000-000000000007',
   '00000000-0000-4000-c000-000000000003',
   'offer', now() - interval '4 days',
   'Verbal offer from Shannon Safety Group',
   '{"company_name":"Shannon Safety Group","status":"verbal"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  ('00000000-0000-4000-1000-00000000000a', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-f000-000000000005',
   '00000000-0000-4000-c000-000000000002',
   'recruiter_response', now() - interval '25 days',
   'Aldergate Regulatory recruiter replied',
   '{"company_name":"Aldergate Regulatory"}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  -- Other business unit.
  ('00000000-0000-4000-1000-00000000000b', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-a000-000000000006', '00000000-0000-4000-f000-00000000000c',
   '00000000-0000-4000-c000-000000000005',
   'interview', now() - interval '6 days',
   'Screening call, Kansai Clinical Partners',
   '{"company_name":"Kansai Clinical Partners","round":1}'::jsonb,
   'manual', now(), '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005')
on conflict (id) do nothing;

select set_config('app.actor_id', '', false);
select set_config('app.source', '', false);
