-- ---------------------------------------------------------------------------
-- MUTATION: let the claim bypass RLS.
--
-- SECURITY DEFINER on a function that updates a table is the quiet way to lose
-- a policy: the SQL is unchanged, the tests that read the table still pass, and
-- the queue's permission simply stops applying to the one operation that takes
-- an item out of it. A candidate could claim a proposal about themselves.
-- ---------------------------------------------------------------------------
create or replace function public.claim_proposal(p_item_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
  update public.intelligence_review_items
     set status = 'in_review',
         claimed_by = auth.uid(),
         claimed_at = now()
   where id = p_item_id
     and claimed_at is null
     and status in ('open', 'in_review')
  returning id;
$$;
