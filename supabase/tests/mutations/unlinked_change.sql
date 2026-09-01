-- ---------------------------------------------------------------------------
-- MUTATION: allow a changed-interpretation decision that names nothing.
--
-- The reviewer is told "a later reading disagrees with what was done" and not
-- told which decision, which reading, or which record — which is worse than not
-- being told at all, because it looks like an answer.
-- ---------------------------------------------------------------------------
alter table public.intelligence_review_items
  drop constraint intelligence_review_items_change_names_its_predecessor;
