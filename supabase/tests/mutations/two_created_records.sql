-- ---------------------------------------------------------------------------
-- MUTATION: let one review item name two created records.
--
-- This is what a retry after a partial failure looks like in the database: the
-- interview was created, the bookkeeping failed, somebody approved again and
-- the item now names an interview AND an assessment. Both are real records; one
-- of them should not exist.
-- ---------------------------------------------------------------------------
alter table public.intelligence_review_items
  drop constraint intelligence_review_items_produces_one_record;
