-- ---------------------------------------------------------------------------
-- MUTATION: allow two readings of one email to run at once.
--
-- Without the partial unique index a double-clicked reprocess spends two
-- provider calls and races itself to a conclusion.
-- ---------------------------------------------------------------------------
drop index public.email_intelligence_runs_one_active;
