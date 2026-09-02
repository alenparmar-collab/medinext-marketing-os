-- ---------------------------------------------------------------------------
-- MUTATION (7C-D): drop the tenant condition from the records a day is
-- counted from.
--
-- An operational day is a count of interviews. Widen the interview policy to
-- "any internal user" and the EU manager's day silently starts including APAC
-- work — the figure still looks plausible, which is what makes it dangerous.
-- ---------------------------------------------------------------------------
drop policy interviews_select_internal on public.interviews;

create policy interviews_select_internal on public.interviews
  for select to authenticated
  using ((select util.is_internal()));
