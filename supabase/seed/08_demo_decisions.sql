-- ===========================================================================
-- DEMO SEED, part 8 — decisions
--
-- DEVELOPMENT AND DEMO ONLY.
--
-- Shape chosen so each Build 7B guarantee is falsifiable:
--   * an AUTO-APPROVED interview that produced a real record, marked
--     unverified because nobody looked at it;
--   * a REVIEW item held for a named, structured reason;
--   * a HUMAN-APPROVED item carrying a correction, with the proposal intact
--     beside it;
--   * a REJECTED item that created nothing;
--   * an item in the other business unit, so tenant isolation can fail.
-- ===========================================================================

select set_config('app.source', 'seed', false);
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000002', false);

-- ---------------------------------------------------------------------------
-- The auto-approved interview.
--
-- The interview row is created here with the provenance the pipeline gives it:
-- source_type email_event, a source_reference naming the reading, and
-- verified_at NULL — because no person confirmed it. That is what "written
-- automatically" means, and every screen showing provenance says so.
-- ---------------------------------------------------------------------------
insert into public.interviews (
  id, business_unit_id, candidate_id, application_id,
  interview_round, scheduled_at, time_zone, meeting_url, interviewer_name,
  status, source_type, source_reference, created_by, updated_by
) values (
  '00000000-0000-4000-9200-000000000031', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000101',
  1, (current_date + 5)::timestamptz + interval '14 hours', 'Europe/London',
  'https://meet.northwind.invalid/auto-1', 'Tom Fletcher',
  'scheduled', 'email_event', 'intelligence:00000000-0000-4000-9b00-000000000002',
  '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

insert into public.intelligence_review_items (
  id, business_unit_id, intelligence_run_id, email_message_id,
  event_type, outcome, status, priority, reason_codes, explanation,
  proposed_candidate_id, proposed_data, candidate_match_confidence, event_confidence,
  final_data, created_interview_id, idempotency_key, reviewed_at
) values (
  '00000000-0000-4000-9c00-000000000001', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9b00-000000000002', '00000000-0000-4000-9800-000000000003',
  'interview', 'auto_approve', 'approved', 'low', '{}',
  'Complete, unambiguous, matched to a candidate with high confidence, and not already on file.',
  '00000000-0000-4000-a000-000000000001',
  '{"company":"Northwind Clinical","job_title":"Clinical Data Manager","time_zone":"Europe/London"}'::jsonb,
  0.950, 0.970,
  '{"company":"Northwind Clinical","job_title":"Clinical Data Manager","time_zone":"Europe/London"}'::jsonb,
  '00000000-0000-4000-9200-000000000031',
  '00000000-0000-4000-9800-000000000003:interview', now() - interval '15 minutes'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Held for review: a name-only candidate match, which is never enough.
-- ---------------------------------------------------------------------------
insert into public.intelligence_review_items (
  id, business_unit_id, intelligence_run_id, email_message_id,
  event_type, outcome, status, priority, reason_codes, explanation,
  proposed_candidate_id, proposed_data, candidate_match_confidence, event_confidence,
  idempotency_key
) values (
  '00000000-0000-4000-9c00-000000000002', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9b00-000000000003', '00000000-0000-4000-9800-000000000002',
  'recruiter_response', 'review_required', 'open', 'normal',
  array['low_candidate_confidence', 'unsupported_event']::decision_reason_code[],
  'The candidate proposal scores 35%, below the threshold for acting without review. '
  'There is no record to create; a person decides whether it means anything.',
  '00000000-0000-4000-a000-000000000001',
  '{"company":"Northwind Clinical","response_summary":"Asks for three windows of availability."}'::jsonb,
  0.350, 0.910,
  '00000000-0000-4000-9800-000000000002:recruiter_response'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Human-approved, with a correction.
--
-- proposed_data keeps what the model said. corrected_data records what the
-- reviewer changed. final_data is what was written. All three survive.
-- ---------------------------------------------------------------------------
insert into public.assessments (
  id, business_unit_id, candidate_id, application_id, assessment_type,
  received_at, deadline, status, source_type, source_reference,
  verified_at, verified_by, created_by, updated_by
) values (
  '00000000-0000-4000-9300-000000000031', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8f00-000000000101',
  'SAS programming exercise',
  now() - interval '10 minutes', (current_date + 4)::timestamptz + interval '23 hours',
  'pending', 'email_event', 'intelligence:00000000-0000-4000-9b00-000000000004',
  now() - interval '10 minutes', '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

insert into public.intelligence_review_items (
  id, business_unit_id, intelligence_run_id, email_message_id,
  event_type, outcome, status, priority, reason_codes, explanation,
  proposed_candidate_id, proposed_data, corrected_data, final_data,
  candidate_match_confidence, event_confidence,
  created_assessment_id, reviewed_by, reviewed_at, decision_notes, idempotency_key
) values (
  '00000000-0000-4000-9c00-000000000003', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9b00-000000000004', '00000000-0000-4000-9800-000000000004',
  'assessment', 'review_required', 'approved', 'normal',
  array['missing_required_field']::decision_reason_code[],
  'The assessment is not named.',
  '00000000-0000-4000-a000-000000000001',
  '{"assessment_type":null,"company":"Halcyon Research","due_date":null}'::jsonb,
  '{"assessment_type":"SAS programming exercise","due_date":"2026-09-04"}'::jsonb,
  '{"assessment_type":"SAS programming exercise","company":"Halcyon Research","due_date":"2026-09-04"}'::jsonb,
  0.950, 0.930,
  '00000000-0000-4000-9300-000000000031',
  '00000000-0000-4000-8000-000000000002', now() - interval '10 minutes',
  'Named the assessment and the deadline from the attached brief.',
  '00000000-0000-4000-9800-000000000004:assessment'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Rejected. Created nothing, and says so.
-- ---------------------------------------------------------------------------
insert into public.intelligence_review_items (
  id, business_unit_id, intelligence_run_id, email_message_id,
  event_type, outcome, status, priority, reason_codes, explanation,
  proposed_data, event_confidence,
  reviewed_by, reviewed_at, decision_notes, idempotency_key
) values (
  '00000000-0000-4000-9c00-000000000004', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9b00-000000000001', '00000000-0000-4000-9800-000000000001',
  'application', 'review_required', 'rejected', 'normal',
  array['no_candidate_match']::decision_reason_code[],
  'No candidate on file matches the identifiers in this email.',
  '{"company":"Northwind Clinical","job_title":"Clinical Data Manager"}'::jsonb,
  0.940,
  '00000000-0000-4000-8000-000000000002', now() - interval '5 minutes',
  'Acknowledgement for an application we already hold. Nothing to create.',
  '00000000-0000-4000-9800-000000000001:application'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The other tenant's decision.
-- ---------------------------------------------------------------------------
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000001', false);

insert into public.intelligence_review_items (
  id, business_unit_id, intelligence_run_id, email_message_id,
  event_type, outcome, status, priority, reason_codes, explanation,
  proposed_data, event_confidence, idempotency_key
) values (
  '00000000-0000-4000-9c00-000000000005', '00000000-0000-4000-9000-000000000002',
  '00000000-0000-4000-9b00-000000000006', '00000000-0000-4000-9800-000000000006',
  'recruiter_response', 'review_required', 'open', 'normal',
  array['unsupported_event']::decision_reason_code[],
  'There is no record to create; a person decides whether it means anything.',
  '{"company":"Kansai Bio"}'::jsonb, 0.930,
  '00000000-0000-4000-9800-000000000006:recruiter_response'
) on conflict (id) do nothing;

select set_config('app.actor_id', '', false);
select set_config('app.source', '', false);
