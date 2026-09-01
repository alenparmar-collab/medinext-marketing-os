-- ---------------------------------------------------------------------------
-- MUTATION: stop auditing decisions.
--
-- Removing the trigger leaves the queue fully functional: proposals are still
-- decided, records are still created, the UI is unchanged. The only thing lost
-- is the answer to "who approved this, and when" — which is the whole reason a
-- machine is allowed to propose CRM writes at all.
-- ---------------------------------------------------------------------------
drop trigger audit_rows on public.intelligence_review_items;
