-- ---------------------------------------------------------------------------
-- MUTATION: remove the idempotency constraint from the review queue.
--
-- Without it a redelivered email, a second reading of the same message and a
-- retried request each produce their own decision — and each of those can be
-- approved into its own interview. The duplicate is invisible in the UI
-- because both rows are legitimate on their own.
-- ---------------------------------------------------------------------------
alter table public.intelligence_review_items
  drop constraint intelligence_review_items_business_unit_id_idempotency_key_key;
