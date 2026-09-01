-- ===========================================================================
-- 0034 — Email intelligence: interpretation, stored as a proposal
--
-- WHAT THIS BUILD DOES, AND WHERE IT STOPS
--
--     EMAIL → AI INTERPRETATION → STRUCTURED RESULT → VALIDATION → STORED
--
-- and then nothing. An intelligence run is a reading of an email, recorded as
-- a proposal. It creates no candidate, no application, no interview, no
-- assessment, no activity and no notification, and there is no code path from
-- this table to any of them. Acting on a proposal is Build 7B's job, with its
-- own decision and review step.
--
-- WHY A SEPARATE TABLE RATHER THAN COLUMNS ON email_messages
--
-- Because an interpretation is not a property of the email. The same message
-- can be read again next month by a better model and get a different answer,
-- and both readings are true statements about what that model concluded on
-- that day. Runs accumulate; the email is never edited. That is the same
-- source/interpretation/verified separation the codebase has held since Build
-- 1, applied to the layer that finally has an interpreter in it.
--
-- WHAT THE MODEL IS NOT TRUSTED WITH
--
-- Identity. The model never returns a candidate id — it cannot, because the
-- schema it answers in has no field for one. It reports the identifiers it
-- OBSERVED in the message, and the server resolves those against this tenant's
-- candidates with deterministic rules. An email saying "the candidate is John
-- Smith, id 0000-..." is data, not an instruction, and there is nowhere for
-- that id to land.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Vocabulary.
--
-- Three separate enums for three separate questions, so no column has to carry
-- two unrelated meanings:
--   status     — where the RUN got to
--   event_type — what the model thinks the EMAIL is about
--   the confidence numbers say how sure it is; they are not statuses
-- ---------------------------------------------------------------------------
create type intelligence_status as enum (
  'pending',          -- queued, nothing sent yet
  'processing',       -- claimed; a provider call is in flight
  'completed',        -- interpreted and validated, confidence high enough to stand
  'review_required',  -- interpreted, but a person should look before anything is acted on
  'failed',           -- the provider or the validation refused it; retryable
  'ignored'           -- filtered out before any provider call (newsletters, empty bodies)
);

create type intelligence_event_type as enum (
  'application',
  'interview',
  'assessment',
  'rejection',
  'recruiter_response',
  -- Not a failure mode. Most of a marketing mailbox is not about any of the
  -- above, and a model with no way to say so will invent one of the others.
  'other'
);

create type intelligence_provider as enum ('openai', 'fixture');

-- ---------------------------------------------------------------------------
-- Runs.
--
-- Everything the interpretation produced, plus everything needed to reproduce
-- and to distrust it: which provider, which model, which prompt version.
-- ---------------------------------------------------------------------------
create table public.email_intelligence_runs (
  id                uuid primary key default gen_random_uuid(),
  business_unit_id  uuid not null references public.business_units(id),
  email_message_id  uuid not null references public.email_messages(id) on delete cascade,

  -- Reprocessing produces run 2, 3, 4 — never an edit of run 1. "What did we
  -- think in March" stays answerable after the prompt is rewritten in April.
  run_number        integer not null default 1,

  provider          intelligence_provider not null,
  model             text not null,
  -- e.g. email_intelligence_v1. Versions coexist; old runs keep the version
  -- they were produced under.
  prompt_version    text not null,

  status            intelligence_status not null default 'pending',
  started_at        timestamptz,
  completed_at      timestamptz,

  -- ---- What the model concluded -----------------------------------------
  event_type        intelligence_event_type,
  event_confidence  numeric(4,3) check (event_confidence between 0 and 1),
  summary           text,

  -- ---- The candidate PROPOSAL -------------------------------------------
  --
  -- Resolved server-side from identifiers the model observed, never chosen by
  -- the model. The composite foreign key makes a cross-tenant proposal
  -- structurally impossible rather than merely unlikely: a candidate from
  -- another business unit cannot satisfy it.
  proposed_candidate_id       uuid,
  candidate_match_confidence  numeric(4,3)
    check (candidate_match_confidence between 0 and 1),
  candidate_match_reasons     text[] not null default '{}',
  candidate_match_evidence    jsonb  not null default '{}'::jsonb,

  -- ---- Structured extraction --------------------------------------------
  -- Shape varies by event type, so jsonb rather than thirty mostly-null
  -- columns. Validated by Zod before it is written; the database holds what
  -- passed.
  extracted_data    jsonb not null default '{}'::jsonb,
  -- Field -> excerpt from the message. An extracted value with no evidence is
  -- an assertion the email does not support.
  evidence          jsonb not null default '[]'::jsonb,

  -- ---- Validation --------------------------------------------------------
  validation_ok     boolean,
  validation_result jsonb not null default '{}'::jsonb,

  -- ---- Failure -----------------------------------------------------------
  error_code        text,
  error_message     text,

  -- ---- Provenance --------------------------------------------------------
  requested_by      uuid references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (email_message_id, run_number),

  constraint email_intelligence_runs_failure_is_explained
    check (status <> 'failed' or error_message is not null),
  constraint email_intelligence_runs_completed_has_a_reading
    check (status not in ('completed', 'review_required')
           or (event_type is not null and event_confidence is not null)),
  constraint email_intelligence_runs_finished_is_timed
    check (status in ('pending', 'processing') or completed_at is not null),
  -- A proposal without a confidence is an unqualified claim about a person.
  constraint email_intelligence_runs_proposal_is_qualified
    check (proposed_candidate_id is null or candidate_match_confidence is not null),

  foreign key (proposed_candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id)
);

-- One run at a time per email. This is the idempotency guarantee that matters
-- for retries: a second attempt cannot start while the first is in flight, so
-- a double-clicked "reprocess" spends one provider call rather than two.
create unique index email_intelligence_runs_one_active
  on public.email_intelligence_runs (email_message_id)
  where status in ('pending', 'processing');

create index email_intelligence_runs_message_idx
  on public.email_intelligence_runs (email_message_id, run_number desc);
create index email_intelligence_runs_queue_idx
  on public.email_intelligence_runs (business_unit_id, status, created_at desc);
create index email_intelligence_runs_event_idx
  on public.email_intelligence_runs (business_unit_id, event_type, event_confidence desc);
create index email_intelligence_runs_proposal_idx
  on public.email_intelligence_runs (proposed_candidate_id)
  where proposed_candidate_id is not null;

create trigger set_updated_at before update on public.email_intelligence_runs
  for each row execute function util.tg_set_updated_at();

comment on table public.email_intelligence_runs is
  'One reading of one email by one model. A PROPOSAL, never a decision: '
  'nothing here creates or modifies a CRM record. Acting on it is Build 7B.';

comment on column public.email_intelligence_runs.proposed_candidate_id is
  'Resolved SERVER-SIDE from identifiers the model observed in the message. '
  'The model never returns a candidate id and has no field to put one in.';

-- ---------------------------------------------------------------------------
-- Run numbering, assigned by the database.
--
-- Computing it in the application would mean a read-then-write race in which
-- two reprocess clicks both decide they are run 3 and one loses to the unique
-- constraint. Here the number is allocated in the same statement that inserts
-- the row.
-- ---------------------------------------------------------------------------
create or replace function util.tg_email_intelligence_run_number()
returns trigger
language plpgsql
as $$
begin
  if new.run_number is null or new.run_number = 1 then
    select coalesce(max(r.run_number), 0) + 1
      into new.run_number
      from public.email_intelligence_runs r
     where r.email_message_id = new.email_message_id;
  end if;
  return new;
end;
$$;

create trigger set_intelligence_run_number
  before insert on public.email_intelligence_runs
  for each row execute function util.tg_email_intelligence_run_number();

-- ---------------------------------------------------------------------------
-- State transitions, enforced rather than remembered.
-- ---------------------------------------------------------------------------
create or replace function util.tg_guard_intelligence_status()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  v_allowed := case old.status
    when 'pending'    then new.status in ('processing', 'ignored', 'failed')
    when 'processing' then new.status in ('completed', 'review_required', 'failed', 'ignored')
    -- Terminal. A different reading is a NEW run, so history is never edited
    -- into a different answer.
    else false
  end;

  if not v_allowed then
    raise exception 'illegal intelligence transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger guard_intelligence_status
  before update on public.email_intelligence_runs
  for each row execute function util.tg_guard_intelligence_status();

-- ---------------------------------------------------------------------------
-- Audit, with the interpretation redacted too.
--
-- Extends the redaction list from 0032. An intelligence run holds extracted
-- content, quoted excerpts and a summary of the message — copying those into
-- the audit log would reproduce the email in a second place with different
-- retention, which is the thing 0032 was written to prevent.
-- ---------------------------------------------------------------------------
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
    'candidate_match_reasons', 'validation_result'
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

create trigger audit_rows after insert or update or delete on public.email_intelligence_runs
  for each row execute function audit.tg_audit_email_row();
