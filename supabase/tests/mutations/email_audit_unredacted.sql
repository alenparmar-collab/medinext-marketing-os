-- ---------------------------------------------------------------------------
-- MUTATION: audit email rows with the generic trigger.
--
-- The generic trigger stores a full row snapshot, which for an email table
-- means copying every body, subject and sender into the audit log — a second
-- copy of the most sensitive content in the product, with different retention
-- and a different read path.
-- ---------------------------------------------------------------------------
drop trigger audit_rows on public.email_messages;

create trigger audit_rows after insert or update or delete on public.email_messages
  for each row execute function audit.tg_audit_row();

-- Re-ingest one message so the log has something to hold.
insert into public.email_messages (
  business_unit_id, mailbox_id, thread_id, provider_message_id,
  from_address, to_addresses, subject, body_text, received_at, source_type, processing_status
) values (
  '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9600-000000000001',
  '00000000-0000-4000-9700-000000000001',
  'msg-audit-probe',
  'probe@example.invalid',
  array['marketing@medinext.invalid']::citext[],
  'Probe subject',
  'Probe body that must never reach the audit log.',
  now(), 'email_event', 'ready'
);
