-- ---------------------------------------------------------------------------
-- MUTATION: let queue access stand in for the CRM permission.
--
-- Two changes, because one alone would leave the other gate holding the line
-- and the guarantee would never actually break:
--
--   1. give recruiters proposal.review, so the queue policy lets them through;
--   2. drop the trigger that requires the permission for the record being
--      created.
--
-- The result is the mistake this design exists to prevent: "may I work this
-- queue" quietly becomes "may I create an interview".
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role_code, permission_code) values
  ('recruiter', 'proposal.review'),
  ('recruiter', 'proposal.approve')
on conflict do nothing;

drop trigger guard_proposal_approval_permission on public.intelligence_review_items;
