-- ===========================================================================
-- 0038 — Build 7B.1: one review item, one CRM action
--
-- Two correctness risks, both found by reading the code rather than by a
-- failure, and both invisible until the day they are not:
--
--   1. TWO APPROVALS, TWO RECORDS. Build 7B read the item's status, checked it
--      was open, and then performed the CRM write. Between those two steps
--      another request can do exactly the same thing. Two tabs, two reviewers,
--      a double-click, a retried request or a retried worker could each pass
--      the check and each create an interview.
--
--   2. A CHANGED READING VANISHING. Idempotency was keyed on (email, event
--      type), which correctly collapses a redelivery — and also collapses a
--      SECOND READING THAT SAYS SOMETHING DIFFERENT. An email re-read as
--      "September 16" after being acted on as "September 15" would have been
--      treated as a duplicate and silently dropped.
--
-- This migration is the database half of both fixes. It adds no feature.
-- ===========================================================================

-- A reading can now disagree with a decision already taken. That is not
-- `conflict_detected` (which means the email contradicts the CRM); it is the
-- system contradicting its own earlier reading, and a reviewer needs to be told
-- which of the two it is.
alter type decision_reason_code add value if not exists 'interpretation_changed';

-- ---------------------------------------------------------------------------
-- The claim, and what a changed reading is measured against.
-- ---------------------------------------------------------------------------
alter table public.intelligence_review_items
  -- Server-computed sha256 over the MATERIAL fields of the proposal — the ones
  -- that decide what the record would be. Never from the model: a fingerprint
  -- an untrusted party could influence would let a crafted email collide with
  -- an existing decision or evade one.
  add column proposal_fingerprint text not null,

  -- The claim. `claimed_at` is a one-shot latch, not a status: status can move
  -- back and forth as reviewers pick items up and put them down, and the thing
  -- that must happen exactly once needs a column that only ever goes one way
  -- while the work is in flight.
  add column claimed_by uuid references public.users(id),
  add column claimed_at timestamptz,

  -- What this decision supersedes, when a later reading disagreed with an
  -- earlier one. Kept as columns rather than derived, because the reviewer's
  -- question — "what did we already do about this email?" — must be answerable
  -- from the row in front of them.
  add column supersedes_item_id uuid references public.intelligence_review_items(id),
  add column superseded_fingerprint text,
  add column superseded_record_id uuid,
  add column superseded_record_kind text
    check (superseded_record_kind is null
           or superseded_record_kind in ('application', 'interview', 'assessment', 'rejection')),
  -- Which material fields moved. Field NAMES only — the values live in the two
  -- proposals, which are both preserved.
  add column changed_fields text[] not null default '{}';

comment on column public.intelligence_review_items.proposal_fingerprint is
  'sha256 of the canonicalised MATERIAL fields of the proposal. Same material '
  'proposal -> same fingerprint. Computed on the server, never by the model.';

comment on column public.intelligence_review_items.claimed_at is
  'One-shot latch. Exactly one request may claim an item; only the holder may '
  'perform the CRM write. Cleared only by releasing a failed attempt.';

-- ---------------------------------------------------------------------------
-- Defence in depth: constraints that make a duplicate action unstorable.
-- ---------------------------------------------------------------------------

-- One item produces at most one record. The three columns already made a second
-- record of the SAME kind impossible; this closes the case where a retry after
-- a partial failure wrote a different kind.
alter table public.intelligence_review_items
  add constraint intelligence_review_items_produces_one_record
  check (
    (case when created_application_id is not null then 1 else 0 end)
    + (case when created_interview_id  is not null then 1 else 0 end)
    + (case when created_assessment_id is not null then 1 else 0 end)
    <= 1
  );

-- An approval that was never claimed did not go through the claim, which means
-- it did not go through the one path that can guarantee it happened once.
-- Automatic approvals claim themselves in the same insert, so this holds for
-- them too.
alter table public.intelligence_review_items
  add constraint intelligence_review_items_approval_was_claimed
  check (status <> 'approved' or claimed_at is not null);

-- A changed-interpretation decision must actually name what it supersedes,
-- otherwise the reviewer is told there is a disagreement and not told with what.
alter table public.intelligence_review_items
  add constraint intelligence_review_items_change_names_its_predecessor
  check (
    not ('interpretation_changed' = any(reason_codes))
    or supersedes_item_id is not null
  );

-- The prior-decision lookup: every evaluation asks "what have we already
-- decided about this email and this event type", newest first.
create index intelligence_review_items_prior_idx
  on public.intelligence_review_items (business_unit_id, email_message_id, event_type, created_at desc);

create index intelligence_review_items_supersedes_idx
  on public.intelligence_review_items (supersedes_item_id)
  where supersedes_item_id is not null;

-- ---------------------------------------------------------------------------
-- THE CLAIM, as one atomic statement.
--
-- Everything about this function is the single UPDATE. Under READ COMMITTED,
-- two concurrent updates to the same row serialise: the second blocks on the
-- first's row lock, and when it resumes it RE-EVALUATES its WHERE clause
-- against the committed row. The winner has set `claimed_at`, so the loser
-- matches no rows and returns null. There is no window between the check and
-- the write, because they are the same statement.
--
-- SECURITY INVOKER, deliberately: the UPDATE policy on the table is what
-- decides who may claim at all, so a candidate or a recruiter without
-- `proposal.review` gets no rows here for the same reason they get none from a
-- plain update. Claiming is not approving — the CRM permission is checked
-- where the record is created, and again by the approval trigger.
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
     and claimed_at is null
     and status in ('open', 'in_review')
  returning id;
$$;

comment on function public.claim_proposal(uuid) is
  'Atomically claims a proposal for approval. Returns the id to exactly one '
  'caller; every other concurrent caller gets null and must not proceed.';

-- ---------------------------------------------------------------------------
-- Releasing a failed attempt.
--
-- A claim that is never released is a proposal nobody can act on again. So a
-- CRM write that fails hands the item back. Narrow on purpose: it only moves an
-- item BACKWARDS to open, only from in_review, and never touches one that has
-- been decided — it cannot turn an approval back into a question.
-- ---------------------------------------------------------------------------
create or replace function public.release_proposal_claim(p_item_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  update public.intelligence_review_items
     set status = 'open',
         claimed_by = null,
         claimed_at = null
   where id = p_item_id
     and status = 'in_review'
     and claimed_at is not null
     and created_application_id is null
     and created_interview_id is null
     and created_assessment_id is null
  returning id;
$$;

grant execute on function public.claim_proposal(uuid) to authenticated;
grant execute on function public.release_proposal_claim(uuid) to authenticated;
