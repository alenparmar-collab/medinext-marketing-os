-- ---------------------------------------------------------------------------
-- MUTATION: audit decisions with the generic trigger.
--
-- The generic trigger stores a full row snapshot. On this table that means the
-- explanation, the proposed data and the corrected data — the parsed contents
-- of the email — land in a log readable by anyone with audit.view, which is a
-- wider audience than email.view.
-- ---------------------------------------------------------------------------
drop trigger audit_rows on public.intelligence_review_items;

create trigger audit_rows after insert or update or delete on public.intelligence_review_items
  for each row execute function audit.tg_audit_row();

insert into public.intelligence_review_items
  (business_unit_id, intelligence_run_id, email_message_id, event_type,
   outcome, proposed_data, explanation, idempotency_key)
values
  ('00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9b00-000000000001',
   '00000000-0000-4000-9800-000000000001',
   'assessment', 'review_required', '{}'::jsonb,
   'Probe explanation quoting the email, which must never reach the audit log.',
   'probe:audit-unredacted');
