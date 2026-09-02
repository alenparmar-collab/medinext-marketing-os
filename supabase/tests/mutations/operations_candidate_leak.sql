-- ---------------------------------------------------------------------------
-- MUTATION (7C-A): let a candidate read the proposals that name them.
--
-- The operational report and the review queue read the same tables. Breaking
-- the queue's policy therefore breaks the report too — which is the point: a
-- report does not leak a report, it leaks the records underneath it.
-- ---------------------------------------------------------------------------
drop policy intelligence_review_items_select on public.intelligence_review_items;

create policy intelligence_review_items_select on public.intelligence_review_items
  for select to authenticated
  using (
    (select util.has_permission('proposal.review'))
    or proposed_candidate_id = (select util.own_candidate_id())
  );
