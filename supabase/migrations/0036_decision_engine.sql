-- ===========================================================================
-- 0036 — The decision layer
--
-- Build 7A ends with a proposal. This is what stands between a proposal and a
-- CRM record:
--
--     PROPOSAL → DECISION → auto-approve | review | ignore | rejected
--                              ↓              ↓
--                        existing CRM     a person
--                          command        decides
--
-- The rule the whole build turns on: AI PROPOSES, THE SERVER DECIDES, AND
-- EXISTING COMMANDS PERFORM THE WRITE. Nothing here inserts an application, an
-- interview or an assessment. This table records what was decided and, once a
-- write has happened, which record it produced.
--
-- WHY A SEPARATE TABLE FROM `review_items`
--
-- Build 5's review_items answers "a record looks inconsistent, somebody
-- check it". This answers "a model proposes we create something, may we?" —
-- different lifecycle, different fields (a proposal, a correction, a resulting
-- record), and a different failure mode. Merging them would give one table two
-- meanings and force half its columns to be null for half its rows.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- What the engine decided, and why.
--
-- Reason codes are an enum rather than free text because they drive behaviour:
-- the queue filters on them, the priority is derived from them, and a test
-- asserts which ones can accompany an auto-approval (none). A free-text reason
-- can accompany them; it cannot replace them.
-- ---------------------------------------------------------------------------
create type decision_outcome as enum (
  'auto_approve',
  'review_required',
  'ignore',
  'rejected'
);

create type decision_reason_code as enum (
  'low_candidate_confidence',
  'ambiguous_candidate',
  'no_candidate_match',
  'missing_date',
  'missing_time',
  'missing_timezone',
  'missing_required_field',
  'duplicate_detected',
  'conflict_detected',
  'status_transition_not_allowed',
  'insufficient_evidence',
  'unsupported_event',
  'third_party_sender',
  'conflicting_candidate_information',
  'actor_lacks_permission',
  'stale_event',
  'other'
);

create type proposal_review_status as enum (
  'open',
  'in_review',
  'approved',
  'rejected',
  'ignored'
);

-- Who decided. Kept apart from the outcome: "the engine chose to auto-approve"
-- and "a person approved it" are different facts about the same record, and an
-- audit that cannot distinguish them is not an audit.
create type decision_actor_kind as enum ('engine', 'human');

-- ---------------------------------------------------------------------------
-- One decision per proposed event.
-- ---------------------------------------------------------------------------
create table public.intelligence_review_items (
  id                  uuid primary key default gen_random_uuid(),
  business_unit_id    uuid not null references public.business_units(id),
  intelligence_run_id uuid not null
                      references public.email_intelligence_runs(id) on delete cascade,
  -- Denormalised so the queue can show the email without joining through the
  -- run, and so an idempotency key can be built without a lookup.
  email_message_id    uuid not null references public.email_messages(id) on delete cascade,

  event_type          intelligence_event_type not null,
  outcome             decision_outcome not null,
  status              proposal_review_status not null default 'open',
  priority            review_item_priority not null default 'normal',

  -- Structured, plus an explanation for the person reading it.
  reason_codes        decision_reason_code[] not null default '{}',
  explanation         text,

  -- ---- The proposal, frozen -------------------------------------------
  --
  -- Copied from the run rather than joined, because a reprocess produces a NEW
  -- run and this item must keep the values it was decided on. "What did we
  -- approve" must survive the model changing its mind.
  proposed_candidate_id      uuid,
  proposed_data              jsonb not null default '{}'::jsonb,
  candidate_match_confidence numeric(4,3)
    check (candidate_match_confidence between 0 and 1),
  event_confidence           numeric(4,3)
    check (event_confidence between 0 and 1),

  -- ---- The human's correction, kept separate ---------------------------
  --
  -- Never written over proposed_data. Three values stay legible side by side:
  -- what the model said, what the person changed, and what was written.
  corrected_data      jsonb,
  final_data          jsonb,

  reviewed_by         uuid references public.users(id),
  reviewed_at         timestamptz,
  decision_notes      text,

  -- ---- What it produced -------------------------------------------------
  created_application_id uuid references public.applications(id) on delete set null,
  created_interview_id   uuid references public.interviews(id)   on delete set null,
  created_assessment_id  uuid references public.assessments(id)  on delete set null,

  -- ---- Idempotency -------------------------------------------------------
  --
  -- (business unit, email, event type). Deliberately NOT the run id: a
  -- reprocess creates a new run, and the point is that the second reading of
  -- the same email about the same event does not produce a second interview.
  -- Deliberately not a timestamp either.
  idempotency_key     text not null,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (business_unit_id, idempotency_key),

  -- An auto-approval that produced nothing is a bug that would otherwise be
  -- invisible; a closed review that names no decider is unattributable.
  constraint intelligence_review_items_decided_is_attributed
    check (status not in ('approved', 'rejected', 'ignored')
           or (reviewed_by is not null or outcome = 'auto_approve')),
  constraint intelligence_review_items_decided_is_timed
    check (status in ('open', 'in_review') or reviewed_at is not null),
  -- Nothing may be auto-approved while carrying a reason to hesitate.
  constraint intelligence_review_items_auto_approval_is_unreserved
    check (outcome <> 'auto_approve' or cardinality(reason_codes) = 0),

  foreign key (proposed_candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id)
);

create index intelligence_review_items_queue_idx
  on public.intelligence_review_items (business_unit_id, status, priority desc, created_at desc);
create index intelligence_review_items_run_idx
  on public.intelligence_review_items (intelligence_run_id);
create index intelligence_review_items_email_idx
  on public.intelligence_review_items (email_message_id);
create index intelligence_review_items_candidate_idx
  on public.intelligence_review_items (proposed_candidate_id)
  where proposed_candidate_id is not null;

create trigger set_updated_at before update on public.intelligence_review_items
  for each row execute function util.tg_set_updated_at();

comment on table public.intelligence_review_items is
  'One decision about one proposed event. Records what was decided and which '
  'CRM record it produced. Performs no writes of its own.';

-- ---------------------------------------------------------------------------
-- Status transitions.
--
-- A decided item is decided. Changing one's mind means a new proposal from a
-- new reading, not an edit that erases what was approved.
-- ---------------------------------------------------------------------------
create or replace function util.tg_guard_proposal_review_status()
returns trigger
language plpgsql
as $$
declare v_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'open'      then new.status in ('in_review', 'approved', 'rejected', 'ignored')
    when 'in_review' then new.status in ('open', 'approved', 'rejected', 'ignored')
    else false
  end;

  if not v_allowed then
    raise exception 'illegal proposal review transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger guard_proposal_review_status
  before update on public.intelligence_review_items
  for each row execute function util.tg_guard_proposal_review_status();

-- ---------------------------------------------------------------------------
-- An approved item must name what it created.
--
-- Without this, "approved" could mean "we said yes and nothing happened",
-- which is the failure the approval pipeline is built to prevent — and the one
-- least likely to be noticed, because the screen says approved.
--
-- `ignore` outcomes are exempt: approving an ignored proposal is not a thing,
-- and a rejection creates nothing by definition.
-- ---------------------------------------------------------------------------
create or replace function util.tg_guard_approval_produced_a_record()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'approved' then
    return new;
  end if;

  if new.created_application_id is null
     and new.created_interview_id is null
     and new.created_assessment_id is null
     -- A rejection decision changes an application's status rather than
     -- creating a row; it names the application it changed.
     and new.event_type <> 'rejection' then
    raise exception 'an approved proposal must name the record it created'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger guard_approval_produced_a_record
  before insert or update on public.intelligence_review_items
  for each row execute function util.tg_guard_approval_produced_a_record();

-- Audit, with the decision's content redacted too.
--
-- Extends the redaction list from 0032/0034 once more. A review item carries the
-- same email-derived content one layer further out: `explanation` quotes the
-- email back to the reviewer, and proposed/corrected/final data hold the parsed
-- interview time, job title and company. The audit log answers "who decided
-- what, and when" -- it is not a second copy of the mailbox, and it is readable
-- by anyone with `audit.view`, which is a wider audience than `email.view`.
--
-- Redefining the shared function (rather than writing a third one) keeps a
-- single list: a column added to any of these tables is redacted or not in one
-- place, and there is no second implementation to forget.
create or replace function audit.tg_audit_email_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
  v_id      uuid;

  c_redacted constant text[] := array[
    -- Message content (0032)
    'body_text', 'body_html', 'snippet', 'headers', 'subject',
    'from_address', 'from_name', 'to_addresses', 'cc_addresses', 'bcc_addresses',
    'normalized_subject', 'file_name', 'error_message', 'last_sync_error',
    'processing_error',
    -- Interpretation of that content (0034)
    'summary', 'extracted_data', 'evidence', 'candidate_match_evidence',
    'candidate_match_reasons', 'validation_result',
    -- The decision taken on that interpretation (0036)
    'explanation', 'proposed_data', 'corrected_data', 'final_data',
    'decision_notes'
  ];
begin
  begin
    v_actor := coalesce(auth.uid(), nullif(current_setting('app.actor_id', true), '')::uuid);
  exception when others then
    v_actor := null;
  end;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);

    select coalesce(array_agg(key order by key), '{}')
      into v_changed
      from jsonb_each(v_new) as e(key, value)
     where v_new -> e.key is distinct from v_old -> e.key;

    if v_changed <@ array['updated_at', 'updated_by', 'last_seen_at'] then
      return new;
    end if;
  end if;

  v_id := coalesce((v_new ->> 'id'), (v_old ->> 'id'))::uuid;

  if v_old is not null then
    v_old := (select jsonb_object_agg(key,
                case when key = any(c_redacted) then to_jsonb('[redacted]'::text) else value end)
              from jsonb_each(v_old));
  end if;
  if v_new is not null then
    v_new := (select jsonb_object_agg(key,
                case when key = any(c_redacted) then to_jsonb('[redacted]'::text) else value end)
              from jsonb_each(v_new));
  end if;

  insert into audit.audit_logs (
    actor_id, actor_kind, action, entity_type, entity_id, entity_schema,
    changed_fields, old_data, new_data, source, request_id
  )
  values (
    v_actor,
    case when v_actor is null then 'system'::public.actor_kind else 'user'::public.actor_kind end,
    lower(tg_op),
    tg_table_name,
    v_id,
    tg_table_schema,
    v_changed,
    v_old,
    v_new,
    coalesce(nullif(current_setting('app.source', true), '')::public.source_kind,
             'email_event'::public.source_kind),
    nullif(current_setting('app.request_id', true), '')::uuid
  );

  return coalesce(new, old);
end;
$$;

create trigger audit_rows after insert or update or delete on public.intelligence_review_items
  for each row execute function audit.tg_audit_email_row();

-- ---------------------------------------------------------------------------
-- CONCURRENCY FIX — intelligence run numbering.
--
-- 0034 allocated run_number with `select max(run_number) + 1`. Under
-- concurrency that is a read-then-write race: two transactions read the same
-- maximum, both compute the same next number, and one loses to the unique
-- constraint — turning a retry into an error rather than a queue.
--
-- A plain sequence cannot fix it, because the number is per email rather than
-- global. What does fix it is serialising the allocation for THAT email: a
-- transaction-scoped advisory lock keyed on the email id. Concurrent runs for
-- different emails never contend; concurrent runs for the same email queue up
-- and get 1, 2, 3.
--
-- The lock is released when the transaction ends, including on rollback, so a
-- failed insert cannot strand it.
-- ---------------------------------------------------------------------------
create or replace function util.tg_email_intelligence_run_number()
returns trigger
language plpgsql
as $$
begin
  if new.run_number is null or new.run_number = 1 then
    -- One bigint key: hashtextextended over a namespaced string, so this lock
    -- cannot collide with an advisory lock taken anywhere else for a different
    -- purpose. (The two-argument form takes two ints, not a bigint and an int.)
    perform pg_advisory_xact_lock(
      hashtextextended('email_intelligence_run_number:' || new.email_message_id::text, 0)
    );

    select coalesce(max(r.run_number), 0) + 1
      into new.run_number
      from public.email_intelligence_runs r
     where r.email_message_id = new.email_message_id;
  end if;
  return new;
end;
$$;

comment on function util.tg_email_intelligence_run_number is
  'Allocates the per-email reading number under a transaction-scoped advisory '
  'lock. The unique constraint on (email_message_id, run_number) remains the '
  'backstop; the lock is what stops it firing under ordinary concurrency.';
