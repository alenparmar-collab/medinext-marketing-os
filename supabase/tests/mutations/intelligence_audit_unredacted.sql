-- ---------------------------------------------------------------------------
-- MUTATION: audit interpretation with the generic trigger.
--
-- The generic trigger stores a full row snapshot, which here means copying the
-- summary, the extraction and the quoted excerpts — the email, in other words
-- — into the audit log.
-- ---------------------------------------------------------------------------
drop trigger audit_rows on public.email_intelligence_runs;

create trigger audit_rows after insert or update or delete on public.email_intelligence_runs
  for each row execute function audit.tg_audit_row();

insert into public.email_intelligence_runs (
  business_unit_id, email_message_id, provider, model, prompt_version,
  status, started_at, completed_at, event_type, event_confidence, summary
) values (
  '00000000-0000-4000-9000-000000000001',
  '00000000-0000-4000-9800-000000000001', 'fixture', 'probe', 'v1',
  'completed', now(), now(), 'interview', 0.99,
  'Probe summary that must never reach the audit log.'
);
