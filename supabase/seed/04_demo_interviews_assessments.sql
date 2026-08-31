-- ===========================================================================
-- DEMO SEED, part 4 — interviews, assessments, notifications, stored files
--
-- DEVELOPMENT AND DEMO ONLY. Every company, role and person is fictional.
--
-- Note what this file does NOT insert: the mirroring marketing_activities, the
-- interview_schedule_history rows, and every notification. Database triggers
-- produce all three. If they are missing after a seed run, the automation is
-- broken — which is exactly what the seed should reveal.
--
-- Shape chosen so each Build 4 guarantee is falsifiable:
--   * Upcoming and completed interviews, on candidates belonging to DIFFERENT
--     recruiters, so "recruiter sees only their own" can fail.
--   * A RESCHEDULED interview performed as a real update, so "the original
--     time is still recoverable" can fail.
--   * Pending and completed assessments.
--   * Interviews and assessments in BOTH business units.
--   * Storage objects matching the document rows, so the storage policies have
--     something to be tested against.
-- ===========================================================================

select set_config('app.source', 'seed', false);
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000003', false);

-- ---------------------------------------------------------------------------
-- Interviews
-- ---------------------------------------------------------------------------
insert into public.interviews (
  id, business_unit_id, candidate_id, application_id,
  interview_round, scheduled_at, time_zone, meeting_url,
  interviewer_name, interviewer_email, status, notes,
  source_type, verified_at, verified_by, created_by
) values
  -- Completed round 1 (Priya · Northwind · Salas)
  ('00000000-0000-4000-9200-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000001',
   1, now() - interval '40 days', 'Europe/London',
   'https://meet.example-northwind.test/round-1',
   'Dara Whitfield', 'd.whitfield@example-northwind.test',
   'passed', 'Strong on CDISC mapping.',
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  -- UPCOMING round 2, and the one that gets rescheduled below.
  ('00000000-0000-4000-9200-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000001',
   2, date_trunc('hour', now() + interval '4 days') + interval '11 hours', 'Europe/London',
   'https://meet.example-northwind.test/round-2',
   'Marguerite Osei', 'm.osei@example-northwind.test',
   'scheduled', null,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  -- Upcoming (Lucia · Shannon · Halvorsen)
  ('00000000-0000-4000-9200-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-8f00-000000000007',
   2, date_trunc('hour', now() + interval '2 days') + interval '14 hours', 'Europe/Dublin',
   'https://meet.example-shannon.test/panel',
   'Niamh Byrne', 'n.byrne@example-shannon.test',
   'scheduled', null,
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  -- Cancelled (Kwame · Aldergate · Salas)
  ('00000000-0000-4000-9200-000000000004', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8f00-000000000005',
   1, now() - interval '10 days', 'Europe/London', null,
   'Ravi Chandrasekaran', null,
   'cancelled', null,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  -- Other business unit (Hiroshi · Kansai · Rossi)
  ('00000000-0000-4000-9200-000000000005', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-a000-000000000006', '00000000-0000-4000-8f00-00000000000c',
   1, now() - interval '6 days', 'Asia/Tokyo', null,
   'Sora Nakamura', null,
   'completed', null,
   'manual', now(), '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A REAL reschedule, performed as an update so the trigger writes history.
--
-- Seeding a "rescheduled" row directly would prove nothing. Moving an existing
-- interview is what makes "the original time is still recoverable" a claim the
-- test suite can falsify.
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('app.schedule_reason', 'Interviewer unavailable; candidate offered a later slot.', true);

  update public.interviews
     set scheduled_at = date_trunc('hour', now() + interval '6 days') + interval '14 hours',
         status = 'rescheduled'
   where id = '00000000-0000-4000-9200-000000000002'
     and status = 'scheduled';

  perform set_config('app.schedule_reason', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Assessments
-- ---------------------------------------------------------------------------
insert into public.assessments (
  id, business_unit_id, candidate_id, application_id,
  assessment_type, assessment_url, received_at, deadline, completed_at,
  status, outcome, notes,
  source_type, verified_at, verified_by, created_by
) values
  -- Completed and passed (Priya · Halcyon)
  ('00000000-0000-4000-9300-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000002',
   'SAS programming', 'https://assess.example-halcyon.test/sas/1201',
   now() - interval '35 days', now() - interval '30 days', now() - interval '31 days',
   'passed', 'Scored 82%.', 'Completed a day before the deadline.',
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  -- PENDING with a deadline still ahead (Priya · Verity)
  ('00000000-0000-4000-9300-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000004',
   'Case study', 'https://assess.example-verity.test/case/88',
   now() - interval '2 days', now() + interval '5 days', null,
   'pending', null, null,
   'manual', now(), '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003'),

  -- In progress (Lucia · Shannon)
  ('00000000-0000-4000-9300-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-8f00-000000000007',
   'Pharmacovigilance scenario', null,
   now() - interval '4 days', now() + interval '3 days', null,
   'in_progress', null, null,
   'manual', now(), '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004'),

  -- Other business unit (Hiroshi · Kansai)
  ('00000000-0000-4000-9300-000000000004', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-a000-000000000006', '00000000-0000-4000-8f00-00000000000c',
   'GCP knowledge check', null,
   now() - interval '5 days', now() + interval '2 days', null,
   'pending', null, null,
   'manual', now(), '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000005')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Stored objects backing the document metadata from seed 02.
--
-- Without these the storage policies have nothing to be tested against, and
-- "a candidate cannot download another candidate's file" would stay a claim
-- rather than an assertion.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema absent — skipping demo objects';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('candidate-documents', 'candidate-documents', false)
  on conflict (id) do nothing;

  insert into storage.objects (bucket_id, name, metadata)
  select d.storage_bucket, d.storage_path,
         jsonb_build_object('size', d.size_bytes, 'mimetype', d.mime_type)
  from public.documents d
  on conflict (bucket_id, name) do nothing;
end;
$$;

select set_config('app.actor_id', '', false);
select set_config('app.source', '', false);
