-- ---------------------------------------------------------------------------
-- MUTATION: let a decision name a candidate from another business unit.
--
-- The composite foreign key is what makes a cross-tenant match structurally
-- impossible rather than merely unlikely. Replacing it with a plain reference
-- to candidates(id) keeps referential integrity — the candidate does exist —
-- while allowing a proposal in one tenant to attach to a person in another.
-- ---------------------------------------------------------------------------
alter table public.intelligence_review_items
  drop constraint intelligence_review_items_proposed_candidate_id_business_u_fkey;

alter table public.intelligence_review_items
  add constraint intelligence_review_items_proposed_candidate_id_fkey
  foreign key (proposed_candidate_id) references public.candidates (id);

-- A proposal in the EU unit naming an APAC candidate. Nothing above refuses it
-- any more.
insert into public.intelligence_review_items
  (business_unit_id, intelligence_run_id, email_message_id, event_type,
   outcome, proposed_data, proposed_candidate_id, candidate_match_confidence,
   idempotency_key)
values
  ('00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-9b00-000000000001',
   '00000000-0000-4000-9800-000000000001',
   'interview', 'review_required', '{}'::jsonb,
   '00000000-0000-4000-a000-000000000006', 0.95,
   'probe:cross-tenant-match');
