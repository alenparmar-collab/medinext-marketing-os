-- ---------------------------------------------------------------------------
-- MUTATION: let internal users edit a reading.
--
-- Both halves have to go, the missing GRANT and the missing policy, or the
-- write fails on privileges and the guarantee is never actually broken. An
-- editable confidence score is a confidence score that means nothing.
-- ---------------------------------------------------------------------------
grant update on public.email_intelligence_runs to authenticated;

create policy email_intelligence_runs_update on public.email_intelligence_runs
  for update to authenticated
  using ((select util.has_permission('intelligence.view')))
  with check ((select util.has_permission('intelligence.view')));
