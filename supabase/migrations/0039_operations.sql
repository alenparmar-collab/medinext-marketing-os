-- ===========================================================================
-- 0039 — Build 7C: making a partial failure visible
--
-- Build 7B.1 handles the gap between the CRM write and the bookkeeping that
-- follows it: one retry, then an error naming the record that was created.
-- What it does NOT do is leave a mark. The row stays claimed, `in_review`, with
-- no created record — which on screen is indistinguishable from "somebody is
-- looking at this right now".
--
-- So the one case a reviewer most needs to find is the one case they cannot,
-- and the daily report cannot count it either. Three columns fix that. No new
-- table, no second status vocabulary: `failure_code` is a marker ON the review
-- item, and every screen derives the words "PARTIAL FAILURE" from it.
--
-- Honest about its own limits: the marker is written best-effort, by the same
-- privileged path whose failure it records. If the database is unreachable the
-- mark cannot be written either — the caller still gets the structured error
-- naming the record, which is the guarantee that does not depend on a write.
-- ===========================================================================

alter table public.intelligence_review_items
  add column failure_code   text
    check (failure_code is null or failure_code in ('partial_failure', 'crm_write_failed')),
  add column failure_detail jsonb,
  add column failed_at      timestamptz;

-- A marked failure must say when, and a timestamp with no code is a fact about
-- nothing.
alter table public.intelligence_review_items
  add constraint intelligence_review_items_failure_is_timed
  check ((failure_code is null) = (failed_at is null));

comment on column public.intelligence_review_items.failure_code is
  'Set when an approval half-completed. partial_failure: the CRM record WAS '
  'created and the bookkeeping was not — do not retry. crm_write_failed: '
  'nothing was created, the claim was released, the item is retryable.';

comment on column public.intelligence_review_items.failure_detail is
  'Structured recovery facts: the created record kind and id where one exists. '
  'Never model output, never an email body.';

-- The operations queue reads "what went wrong today" constantly and "what is
-- open" constantly. Both are narrow slices of a table that only grows.
create index intelligence_review_items_failures_idx
  on public.intelligence_review_items (business_unit_id, failed_at desc)
  where failure_code is not null;

create index intelligence_review_items_open_idx
  on public.intelligence_review_items (business_unit_id, priority, created_at)
  where status in ('open', 'in_review');

-- ---------------------------------------------------------------------------
-- What the reading OBSERVED, kept.
--
-- The model already reports the identifiers it saw in the message — that is how
-- server-side matching works, and the schema has carried the field since 7A.
-- It was used and discarded. Nothing here changes the extraction, the prompt or
-- the matching algorithm; it stores an output that was already being produced.
--
-- Why it matters: when matching resolves nobody, "we could not identify this
-- person" is not something a reviewer can act on. "The message named
-- vishnu.k@example.invalid and two candidates share that name" is. Without
-- this column the review screen can state the problem and not the evidence.
-- ---------------------------------------------------------------------------
alter table public.email_intelligence_runs
  add column observed_identifiers jsonb not null default '{}'::jsonb;

comment on column public.email_intelligence_runs.observed_identifiers is
  'Identifiers the model reported seeing in the message. Resolved server-side '
  'against this tenant''s candidates; the model never returns a candidate id.';

-- Personal data lifted out of an email body, so it is redacted on the way to
-- the audit log like every other piece of message content.
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
    'decision_notes',
    -- Identifiers observed in the message (0039)
    'observed_identifiers'
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
