-- ---------------------------------------------------------------------------
-- MUTATION: let internal users edit the evidence.
--
-- Evidence that can be edited through the API is not evidence. Both halves
-- have to go — the missing GRANT and the missing policy — or the write still
-- fails on privileges and the guarantee is never actually broken.
-- ---------------------------------------------------------------------------
grant update on public.email_messages to authenticated;

create policy email_messages_update on public.email_messages
  for update to authenticated
  using ((select util.has_permission('email.view')))
  with check ((select util.has_permission('email.view')));
