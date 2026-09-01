-- ---------------------------------------------------------------------------
-- MUTATION: allow a proposal to name a candidate from another tenant.
--
-- Replacing the composite foreign key with a plain one looks equivalent and
-- silently drops the business-unit half, which is the only thing making a
-- cross-tenant proposal unstorable.
-- ---------------------------------------------------------------------------
alter table public.email_intelligence_runs
  drop constraint email_intelligence_runs_proposed_candidate_id_business_uni_fkey;

alter table public.email_intelligence_runs
  add constraint email_intelligence_runs_proposed_candidate_fkey
  foreign key (proposed_candidate_id) references public.candidates(id);
