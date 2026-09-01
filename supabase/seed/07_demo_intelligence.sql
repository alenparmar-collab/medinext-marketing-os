-- ===========================================================================
-- DEMO SEED, part 7 — interpretation results
--
-- DEVELOPMENT AND DEMO ONLY. Every reading below is fictional and was written
-- by hand; no model produced them and none is claimed to have.
--
-- Shape chosen so each Build 7A guarantee is falsifiable:
--   * a confident reading with an exact-email candidate proposal;
--   * a confident reading whose candidate proposal is only a NAME, held for
--     review — the rule that a name is never enough;
--   * TWO readings of the same email, so "reprocessing versions rather than
--     overwrites" can fail;
--   * a failed run, so retryability can fail;
--   * an ignored newsletter, so pre-filtering can fail;
--   * a reading in the other business unit, so tenant isolation can fail.
--
-- What this file deliberately does NOT contain: any application, interview,
-- assessment, activity or notification created from a reading. There is
-- nowhere to put one.
-- ===========================================================================

select set_config('app.source', 'seed', false);
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000002', false);

-- ---------------------------------------------------------------------------
-- Reading 1 of the scheduling email: confident, with an exact-email match.
-- ---------------------------------------------------------------------------
insert into public.email_intelligence_runs (
  id, business_unit_id, email_message_id, run_number,
  provider, model, prompt_version, status, started_at, completed_at,
  event_type, event_confidence, summary,
  proposed_candidate_id, candidate_match_confidence, candidate_match_reasons,
  candidate_match_evidence, extracted_data, evidence,
  validation_ok, validation_result, requested_by
) values (
  '00000000-0000-4000-9b00-000000000001', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9800-000000000003', 1,
  'fixture', 'fixture-v1', 'email_intelligence_v1', 'completed',
  now() - interval '90 minutes', now() - interval '89 minutes',
  'interview', 0.940,
  'Confirms a first-round interview on Thursday at 14:00 London time.',
  '00000000-0000-4000-a000-000000000001', 0.950,
  array['The message contains this candidate''s email address (priya.raman@example.invalid).'],
  '{"matchedEmail":"priya.raman@example.invalid"}'::jsonb,
  '{"company":"Northwind Clinical","job_title":"Clinical Data Manager","interview_date":"2026-08-27","interview_time":"14:00","timezone":"Europe/London","interview_mode":"video","interviewer":"Tom Fletcher"}'::jsonb,
  '[{"field":"interview_date","excerpt":"Confirming Thursday at 14:00 London time"},{"field":"interviewer","excerpt":"with Priya Sundaram and Tom Fletcher"}]'::jsonb,
  true, '{"issues":{}}'::jsonb, '00000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Reading 2 of the SAME email, under a later prompt version.
--
-- Reprocessing adds; it never edits. Both readings stay legible, which is what
-- makes "the model changed its mind after the upgrade" answerable.
-- ---------------------------------------------------------------------------
insert into public.email_intelligence_runs (
  id, business_unit_id, email_message_id, run_number,
  provider, model, prompt_version, status, started_at, completed_at,
  event_type, event_confidence, summary,
  proposed_candidate_id, candidate_match_confidence, candidate_match_reasons,
  candidate_match_evidence, extracted_data, evidence,
  validation_ok, validation_result, requested_by
) values (
  '00000000-0000-4000-9b00-000000000002', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9800-000000000003', 2,
  'fixture', 'fixture-v1', 'email_intelligence_v1', 'completed',
  now() - interval '20 minutes', now() - interval '19 minutes',
  'interview', 0.970,
  'Confirms a first-round interview on Thursday 27 August at 14:00 London time, by video.',
  '00000000-0000-4000-a000-000000000001', 0.950,
  array['The message contains this candidate''s email address (priya.raman@example.invalid).'],
  '{"matchedEmail":"priya.raman@example.invalid"}'::jsonb,
  '{"company":"Northwind Clinical","job_title":"Clinical Data Manager","interview_date":"2026-08-27","interview_time":"14:00","timezone":"Europe/London","interview_mode":"video","interviewer":"Tom Fletcher","meeting_url":"https://meet.northwind.invalid/abc-defg"}'::jsonb,
  '[{"field":"interview_date","excerpt":"Confirming Thursday at 14:00 London time"},{"field":"meeting_url","excerpt":"Joining details are attached"}]'::jsonb,
  true, '{"issues":{}}'::jsonb, '00000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A confident classification whose candidate proposal rests on a NAME alone.
--
-- Held for review on purpose. This is the case the matching rules exist for.
-- ---------------------------------------------------------------------------
insert into public.email_intelligence_runs (
  id, business_unit_id, email_message_id, run_number,
  provider, model, prompt_version, status, started_at, completed_at,
  event_type, event_confidence, summary,
  proposed_candidate_id, candidate_match_confidence, candidate_match_reasons,
  candidate_match_evidence, extracted_data, evidence,
  validation_ok, validation_result, requested_by
) values (
  '00000000-0000-4000-9b00-000000000003', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9800-000000000002', 1,
  'fixture', 'fixture-v1', 'email_intelligence_v1', 'review_required',
  now() - interval '80 minutes', now() - interval '79 minutes',
  'recruiter_response', 0.910,
  'The hiring manager asks for availability. No interview has been arranged.',
  '00000000-0000-4000-a000-000000000001', 0.350,
  array['Only this candidate''s name appears in the message, with nothing to corroborate it. A name is not an identifier.'],
  '{"matchedName":"Priya Raman"}'::jsonb,
  '{"company":"Northwind Clinical","response_summary":"Asks for three windows of availability."}'::jsonb,
  '[{"field":"response_summary","excerpt":"Could you share three windows of availability?"}]'::jsonb,
  true, '{"issues":{}}'::jsonb, '00000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A failed run. Retryable, and it kept a reason somebody can act on.
-- ---------------------------------------------------------------------------
insert into public.email_intelligence_runs (
  id, business_unit_id, email_message_id, run_number,
  provider, model, prompt_version, status, started_at, completed_at,
  validation_ok, validation_result, error_code, error_message, requested_by
) values (
  '00000000-0000-4000-9b00-000000000004', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9800-000000000004', 1,
  'fixture', 'fixture-v1', 'email_intelligence_v1', 'failed',
  now() - interval '70 minutes', now() - interval '70 minutes',
  false, '{"issues":{}}'::jsonb,
  'provider_unavailable',
  'The interpretation provider was unavailable. This run can be retried.',
  '00000000-0000-4000-8000-000000000002'
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- An ignored message: filtered before any provider call.
-- ---------------------------------------------------------------------------
insert into public.email_intelligence_runs (
  id, business_unit_id, email_message_id, run_number,
  provider, model, prompt_version, status, completed_at,
  event_type, event_confidence, summary, validation_ok, validation_result
) values (
  '00000000-0000-4000-9b00-000000000005', '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9800-000000000005', 1,
  'fixture', 'fixture-v1', 'email_intelligence_v1', 'ignored',
  now() - interval '60 minutes',
  'other', 1.000, 'The sender marked this as bulk or list mail.',
  true, '{"skipped":true}'::jsonb
) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The other tenant's reading. Nothing in the EU unit may ever see this row.
-- ---------------------------------------------------------------------------
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000001', false);

insert into public.email_intelligence_runs (
  id, business_unit_id, email_message_id, run_number,
  provider, model, prompt_version, status, started_at, completed_at,
  event_type, event_confidence, summary, validation_ok, validation_result
) values (
  '00000000-0000-4000-9b00-000000000006', '00000000-0000-4000-9000-000000000002',
  '00000000-0000-4000-9800-000000000006', 1,
  'fixture', 'fixture-v1', 'email_intelligence_v1', 'completed',
  now() - interval '50 minutes', now() - interval '49 minutes',
  'recruiter_response', 0.930,
  'Kansai Bio would like to arrange a screening call.',
  true, '{"issues":{}}'::jsonb
) on conflict (id) do nothing;

select set_config('app.actor_id', '', false);
select set_config('app.source', '', false);
