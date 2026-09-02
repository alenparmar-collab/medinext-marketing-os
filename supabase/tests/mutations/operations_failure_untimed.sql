-- ---------------------------------------------------------------------------
-- MUTATION: allow a failure mark with no time.
--
-- "Something failed, at no particular moment" cannot be put on a timeline, and
-- the operations day cannot count it into the day it happened.
-- ---------------------------------------------------------------------------
alter table public.intelligence_review_items
  drop constraint intelligence_review_items_failure_is_timed;
