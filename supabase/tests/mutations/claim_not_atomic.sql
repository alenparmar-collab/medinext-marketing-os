-- ---------------------------------------------------------------------------
-- MUTATION: take the latch out of the claim.
--
-- The version somebody writes when the claim "looks redundant" next to the
-- status check: keep the status transition, drop `claimed_at is null`. It reads
-- as equivalent and it is not — the status can be `in_review` legitimately, so
-- a second caller walks straight through and reaches the CRM write.
-- ---------------------------------------------------------------------------
create or replace function public.claim_proposal(p_item_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  update public.intelligence_review_items
     set status = 'in_review',
         claimed_by = auth.uid(),
         claimed_at = now()
   where id = p_item_id
     and status in ('open', 'in_review')
  returning id;
$$;
