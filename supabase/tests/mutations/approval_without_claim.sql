-- ---------------------------------------------------------------------------
-- MUTATION: allow an approval that was never claimed.
--
-- Removing this constraint leaves the claim in place and makes it optional. Any
-- code path that forgets to claim — a new command, a fix applied in a hurry, a
-- script — can then record an approval that never went through the one
-- mechanism that guarantees it happened once.
-- ---------------------------------------------------------------------------
alter table public.intelligence_review_items
  drop constraint intelligence_review_items_approval_was_claimed;
