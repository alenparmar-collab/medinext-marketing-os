-- ---------------------------------------------------------------------------
-- MUTATION: drop the tenant condition from the email policy.
--
-- Everything else stays: internal only, capability required. Only the business
-- unit check goes, which is exactly the condition that stops one unit reading
-- another's mailbox.
-- ---------------------------------------------------------------------------
drop policy email_messages_select on public.email_messages;

create policy email_messages_select on public.email_messages
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('email.view'))
  );
