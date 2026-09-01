-- ---------------------------------------------------------------------------
-- MUTATION: give candidates a way in.
--
-- The policy below looks like the "safe" version somebody writes when asked to
-- let a candidate see "their own" email: it gates on being a candidate rather
-- than on which mailbox the message belongs to. There is no per-candidate
-- filter available, because nothing has been matched to a candidate yet — so
-- this hands every candidate the entire mailbox.
-- ---------------------------------------------------------------------------
create policy email_messages_select_candidate on public.email_messages
  for select to authenticated
  using ((select util.own_candidate_id()) is not null);
