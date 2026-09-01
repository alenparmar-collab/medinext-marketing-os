-- ---------------------------------------------------------------------------
-- MUTATION: make reprocessing overwrite instead of append.
--
-- Dropping the per-email run numbering and keeping one row per message is the
-- obvious simplification, and it destroys the history that makes "what did we
-- think in March" answerable.
-- ---------------------------------------------------------------------------
drop trigger set_intelligence_run_number on public.email_intelligence_runs;

delete from public.email_intelligence_runs
 where email_message_id = '00000000-0000-4000-9800-000000000003'
   and run_number = 1;
