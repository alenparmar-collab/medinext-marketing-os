-- ---------------------------------------------------------------------------
-- MUTATION: let any internal user work the proposal queue.
--
-- The version somebody writes when a recruiter asks why they cannot see the
-- queue: drop the capability check and keep "is internal" plus the tenant
-- condition. It reads as reasonable and it hands every recruiter in the unit a
-- feed of unverified model output about candidates they do not work on.
-- ---------------------------------------------------------------------------
drop policy intelligence_review_items_select on public.intelligence_review_items;

create policy intelligence_review_items_select on public.intelligence_review_items
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.in_business_unit(business_unit_id))
  );
