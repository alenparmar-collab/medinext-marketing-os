-- ---------------------------------------------------------------------------
-- MUTATION: drop the tenant condition from the queue policy.
--
-- The capability check stays, so this looks safe in review — a manager holds
-- proposal.review, and the queue is internal either way. What it actually does
-- is put every business unit's proposals in front of every manager.
-- ---------------------------------------------------------------------------
drop policy intelligence_review_items_select on public.intelligence_review_items;

create policy intelligence_review_items_select on public.intelligence_review_items
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('proposal.review'))
  );
