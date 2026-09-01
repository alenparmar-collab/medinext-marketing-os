-- ===========================================================================
-- DEMO SEED, part 6 — email evidence
--
-- DEVELOPMENT AND DEMO ONLY. Every address is fictional and every domain is
-- `.invalid`, which is reserved by RFC 2606 and can never resolve.
--
-- Shape chosen so each Build 6 guarantee is falsifiable:
--   * TWO threads with several messages each, so threading can fail.
--   * A message inserted TWICE, so idempotency can fail.
--   * Attachment metadata, so the attachment path can fail.
--   * A mailbox in the other business unit, so tenant isolation can fail.
--   * A failed sync run followed by a successful one, so "the cursor survives
--     a failure" can fail.
--
-- What this file deliberately does NOT contain: any link from an email to a
-- candidate, application, interview or assessment. There is nowhere to put
-- one, which is the point of the build.
-- ===========================================================================

select set_config('app.source', 'seed', false);
select set_config('app.actor_id', '00000000-0000-4000-8000-000000000001', false);

insert into public.mailboxes
  (id, business_unit_id, provider, mailbox_address, display_name, status,
   sync_cursor, last_successful_sync_at, last_sync_attempted_at,
   connected_by, connected_at)
values
  ('00000000-0000-4000-9600-000000000001', '00000000-0000-4000-9000-000000000001',
   'gmail', 'marketing@medinext.invalid', 'EU marketing mailbox', 'connected',
   'history-1042', now() - interval '2 hours', now() - interval '2 hours',
   '00000000-0000-4000-8000-000000000001', now() - interval '30 days'),

  -- APAC. Exists only so cross-tenant isolation has something to fail against.
  ('00000000-0000-4000-9600-000000000002', '00000000-0000-4000-9000-000000000002',
   'gmail', 'apac-marketing@medinext.invalid', 'APAC marketing mailbox', 'connected',
   'history-77', now() - interval '1 day', now() - interval '1 day',
   '00000000-0000-4000-8000-000000000001', now() - interval '20 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Threads. Keyed on the provider's thread id, exactly as ingestion does it.
-- ---------------------------------------------------------------------------
insert into public.email_threads
  (id, business_unit_id, mailbox_id, provider_thread_id, normalized_subject)
values
  ('00000000-0000-4000-9700-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', 'thread-northwind-0001',
   'Northwind Clinical — Data Manager application'),

  ('00000000-0000-4000-9700-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', 'thread-halcyon-0002',
   'Halcyon Research — technical assessment'),

  ('00000000-0000-4000-9700-000000000003', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-9600-000000000002', 'thread-kansai-0003',
   'Kansai Bio — screening call')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Thread one: acknowledgement, recruiter reply, scheduling.
--
-- The third message is plainly about an interview. Nothing in this build reads
-- that, and no interview record exists because of it — which is exactly the
-- separation the architecture is for.
-- ---------------------------------------------------------------------------
insert into public.email_messages (
  id, business_unit_id, mailbox_id, thread_id,
  provider_message_id, internet_message_id, in_reply_to, references_header,
  from_address, from_name, to_addresses, subject, snippet, body_text,
  sent_at, received_at, has_attachments, attachment_count,
  source_type, processing_status
) values
  ('00000000-0000-4000-9800-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', '00000000-0000-4000-9700-000000000001',
   'msg-northwind-001', '<northwind-001@northwind.invalid>', null, '{}',
   'no-reply@northwind.invalid', 'Northwind Careers',
   array['marketing@medinext.invalid']::citext[],
   'We have received your application',
   'Thank you for applying to the Clinical Data Manager role.',
   E'Thank you for applying to the Clinical Data Manager role at Northwind Clinical.\n\nOur team reviews applications weekly. You will hear from us either way.\n\n— Northwind Careers',
   now() - interval '9 days', now() - interval '9 days', false, 0,
   'email_event', 'ready'),

  ('00000000-0000-4000-9800-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', '00000000-0000-4000-9700-000000000001',
   'msg-northwind-002', '<northwind-002@northwind.invalid>',
   '<northwind-001@northwind.invalid>', array['<northwind-001@northwind.invalid>'],
   'r.okonkwo@northwind.invalid', 'Rachel Okonkwo',
   array['marketing@medinext.invalid']::citext[],
   'Re: We have received your application',
   'The hiring manager would like to speak with your candidate.',
   E'Hello,\n\nThe hiring manager has reviewed the CV and would like to speak with your candidate this week.\n\nCould you share three windows of availability?\n\nBest,\nRachel Okonkwo\nNorthwind Clinical',
   now() - interval '6 days', now() - interval '6 days', false, 0,
   'email_event', 'ready'),

  ('00000000-0000-4000-9800-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', '00000000-0000-4000-9700-000000000001',
   'msg-northwind-003', '<northwind-003@northwind.invalid>',
   '<northwind-002@northwind.invalid>',
   array['<northwind-001@northwind.invalid>', '<northwind-002@northwind.invalid>'],
   'r.okonkwo@northwind.invalid', 'Rachel Okonkwo',
   array['marketing@medinext.invalid']::citext[],
   'Re: We have received your application',
   'Confirming Thursday at 14:00 London time.',
   E'Confirming Thursday at 14:00 London time, with Priya Sundaram and Tom Fletcher.\n\nJoining details are attached.\n\nRachel',
   now() - interval '4 days', now() - interval '4 days', true, 1,
   'email_event', 'ready'),

-- ---------------------------------------------------------------------------
-- Thread two: an assessment request and a chase.
-- ---------------------------------------------------------------------------
  ('00000000-0000-4000-9800-000000000004', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', '00000000-0000-4000-9700-000000000002',
   'msg-halcyon-001', '<halcyon-001@halcyon.invalid>', null, '{}',
   'assessments@halcyon.invalid', 'Halcyon Research',
   array['marketing@medinext.invalid']::citext[],
   'Technical assessment — please complete within 5 days',
   'The assessment link is valid for five days.',
   E'Please ask your candidate to complete the attached technical assessment within five days.\n\nThe platform link expires automatically.\n\n— Halcyon Research',
   now() - interval '7 days', now() - interval '7 days', true, 2,
   'email_event', 'ready'),

  ('00000000-0000-4000-9800-000000000005', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', '00000000-0000-4000-9700-000000000002',
   'msg-halcyon-002', '<halcyon-002@halcyon.invalid>',
   '<halcyon-001@halcyon.invalid>', array['<halcyon-001@halcyon.invalid>'],
   'assessments@halcyon.invalid', 'Halcyon Research',
   array['marketing@medinext.invalid']::citext[],
   'Re: Technical assessment — please complete within 5 days',
   'A reminder that the assessment window closes tomorrow.',
   E'A reminder that the assessment window closes tomorrow.\n\n— Halcyon Research',
   now() - interval '3 days', now() - interval '3 days', false, 0,
   'email_event', 'ready'),

-- ---------------------------------------------------------------------------
-- The other tenant's message. Nothing in the EU unit may ever see this row.
-- ---------------------------------------------------------------------------
  ('00000000-0000-4000-9800-000000000006', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-9600-000000000002', '00000000-0000-4000-9700-000000000003',
   'msg-kansai-001', '<kansai-001@kansai.invalid>', null, '{}',
   'hiring@kansai.invalid', 'Kansai Bio',
   array['apac-marketing@medinext.invalid']::citext[],
   'Screening call for your candidate',
   'We would like to arrange a screening call.',
   E'We would like to arrange a screening call for next week.\n\n— Kansai Bio',
   now() - interval '5 days', now() - interval '5 days', false, 0,
   'email_event', 'ready')
on conflict (mailbox_id, provider_message_id) do nothing;

-- ---------------------------------------------------------------------------
-- IDEMPOTENCY, demonstrated rather than asserted.
--
-- The provider offers msg-northwind-003 again, as a redelivery would. The
-- unique constraint absorbs it: last_seen_at moves, the evidence does not, and
-- no second row appears. If this ever inserted a duplicate, the assertion in
-- the suite would fail rather than the seed failing loudly here.
-- ---------------------------------------------------------------------------
insert into public.email_messages (
  id, business_unit_id, mailbox_id, thread_id,
  provider_message_id, from_address, to_addresses, subject,
  received_at, source_type, processing_status
) values (
  gen_random_uuid(), '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9600-000000000001', '00000000-0000-4000-9700-000000000001',
  'msg-northwind-003', 'r.okonkwo@northwind.invalid',
  array['marketing@medinext.invalid']::citext[],
  'Re: We have received your application',
  now() - interval '4 days', 'email_event', 'ready'
)
on conflict (mailbox_id, provider_message_id) do update
  set last_seen_at = now();

-- ---------------------------------------------------------------------------
-- Attachment metadata. Metadata only — no bytes were fetched, and the storage
-- path is null to say so rather than implying a file exists.
-- ---------------------------------------------------------------------------
insert into public.email_attachments
  (id, business_unit_id, message_id, provider_attachment_id, file_name, mime_type, size_bytes)
values
  ('00000000-0000-4000-9900-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9800-000000000003', 'att-northwind-003-1',
   'joining-details.pdf', 'application/pdf', 84213),
  ('00000000-0000-4000-9900-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9800-000000000004', 'att-halcyon-001-1',
   'assessment-brief.pdf', 'application/pdf', 152004),
  ('00000000-0000-4000-9900-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9800-000000000004', 'att-halcyon-001-2',
   'scoring-guide.docx',
   'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 38112)
on conflict (message_id, provider_attachment_id) do nothing;

-- ---------------------------------------------------------------------------
-- Sync history: a failure, then a success.
--
-- The failed run carries no cursor_after — it established no new position —
-- and the mailbox still holds the cursor from the successful run. That is the
-- guarantee "a failure does not lose the last good position", written as data.
-- ---------------------------------------------------------------------------
insert into public.mailbox_sync_runs
  (id, business_unit_id, mailbox_id, trigger_kind, status, started_at, finished_at,
   cursor_before, cursor_after, messages_seen, messages_created, messages_updated,
   error_message, started_by)
values
  ('00000000-0000-4000-9a00-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', 'initial', 'succeeded',
   now() - interval '30 days', now() - interval '30 days' + interval '40 seconds',
   null, 'history-1000', 5, 5, 0, null, '00000000-0000-4000-8000-000000000001'),

  ('00000000-0000-4000-9a00-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', 'manual', 'failed',
   now() - interval '3 hours', now() - interval '3 hours' + interval '4 seconds',
   'history-1000', null, 0, 0, 0,
   'The mailbox provider was temporarily unavailable. The next sync will resume.',
   '00000000-0000-4000-8000-000000000001'),

  ('00000000-0000-4000-9a00-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9600-000000000001', 'manual', 'succeeded',
   now() - interval '2 hours', now() - interval '2 hours' + interval '31 seconds',
   'history-1000', 'history-1042', 6, 1, 5, null,
   '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

select set_config('app.actor_id', '', false);
select set_config('app.source', '', false);
