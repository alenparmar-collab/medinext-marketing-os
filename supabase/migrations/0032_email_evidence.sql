-- ===========================================================================
-- 0032 — Email evidence layer
--
-- WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
--
-- This build connects a marketing mailbox and preserves what arrives. It does
-- not interpret any of it. There is no path from an email row to an
-- application, interview, assessment, rejection, candidate or assignment —
-- not a foreign key, not a trigger, not a function. That absence is the
-- architecture, and a test asserts it stays absent.
--
-- The reason is the one this codebase has held since Build 1: source data,
-- interpretation and verified business records stay conceptually separate. An
-- email is evidence of something. Deciding what it is evidence OF is a
-- separate step, with its own validation and its own review queue, and it
-- belongs to a later build.
--
-- WHERE THESE TABLES LIVE
--
-- In `public`, alongside the verified records, because PostgREST exposes only
-- `public` and the explorer has to read them through RLS like everything else.
-- The separation is therefore enforced by structure rather than by schema
-- name: no email table references a CRM table, and no CRM table references an
-- email table.
--
-- WHAT IS NOT IN THE DATABASE
--
-- OAuth client secrets: environment only, never a column.
-- Provider tokens: `private.mailbox_credentials`, encrypted by the application
-- before it ever reaches Postgres, in a schema with no grants to
-- `authenticated` at all. See migration 0033.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Vocabulary.
--
-- Note what the processing states do NOT include: nothing here says
-- "classified", "extracted" or "matched". Those would be lies in Build 6 —
-- there is no interpretation layer to produce them.
-- ---------------------------------------------------------------------------
create type email_provider as enum ('gmail', 'microsoft', 'imap');

create type mailbox_status as enum (
  'disconnected',  -- never connected, or the connection was withdrawn
  'connected',     -- authorized and syncing
  'error',         -- authorized, but the last sync failed
  'revoked'        -- the provider rejected our credentials
);

create type email_processing_status as enum (
  'received',    -- the provider told us it exists
  'stored',      -- normalized and persisted, evidence preserved
  'ready',       -- complete and available to a future interpretation layer
  'processing',  -- claimed by a worker
  'failed'       -- ingestion could not complete; see processing_error
);

create type email_sync_status as enum ('running', 'succeeded', 'failed');

create type email_sync_trigger as enum ('initial', 'manual', 'scheduled');

-- ---------------------------------------------------------------------------
-- Mailboxes.
--
-- One row per connected mailbox per business unit. Provider is an enum rather
-- than a boolean "is_gmail", so the second provider is a value rather than a
-- refactor.
--
-- The two sync timestamps are separate on purpose. Showing the last ATTEMPT as
-- though it were the last SUCCESS is how a mailbox silently stops working for
-- a fortnight while the screen says everything is fine.
-- ---------------------------------------------------------------------------
create table public.mailboxes (
  id                uuid primary key default gen_random_uuid(),
  business_unit_id  uuid not null references public.business_units(id),

  provider          email_provider not null,
  -- The address as the provider knows it. citext because mailbox addresses are
  -- case-insensitive in practice and comparing them case-sensitively creates
  -- duplicates nobody can see.
  mailbox_address   citext not null,
  display_name      text,

  status            mailbox_status not null default 'disconnected',

  -- The provider's incremental cursor (Gmail historyId, an IMAP UIDVALIDITY
  -- pair, …). Written ONLY on a successful sync, so a failure cannot lose the
  -- last known-good position.
  sync_cursor            text,
  last_successful_sync_at timestamptz,
  last_sync_attempted_at  timestamptz,
  -- Safe for internal eyes: a short reason, never a token or a raw provider
  -- payload. The ingestion service is responsible for keeping it that way.
  last_sync_error        text,

  connected_by      uuid references public.users(id),
  connected_at      timestamptz,
  disconnected_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint mailboxes_address_present check (length(btrim(mailbox_address::text)) > 0),
  unique (business_unit_id, provider, mailbox_address)
);

create index mailboxes_unit_idx on public.mailboxes (business_unit_id, status);

create trigger set_updated_at before update on public.mailboxes
  for each row execute function util.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Threads.
--
-- Keyed on the PROVIDER's thread id, never on the subject. Subjects collide
-- constantly ("Re: Application"), get edited mid-thread, and are trivially
-- forgeable; the provider's identifier is the only thing that actually says
-- "these messages are the same conversation".
--
-- normalized_subject exists for display and grouping, not for identity.
-- ---------------------------------------------------------------------------
create table public.email_threads (
  id                uuid primary key default gen_random_uuid(),
  business_unit_id  uuid not null references public.business_units(id),
  mailbox_id        uuid not null references public.mailboxes(id) on delete cascade,

  provider_thread_id text not null,
  normalized_subject text,

  first_message_at  timestamptz,
  last_message_at   timestamptz,
  message_count     integer not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (mailbox_id, provider_thread_id),
  -- Lets a message's composite FK guarantee it cannot be attached to a thread
  -- belonging to another mailbox.
  unique (id, mailbox_id)
);

create index email_threads_recent_idx
  on public.email_threads (mailbox_id, last_message_at desc);
create index email_threads_subject_trgm
  on public.email_threads using gin (normalized_subject gin_trgm_ops);

create trigger set_updated_at before update on public.email_threads
  for each row execute function util.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Messages — the evidence.
--
-- The unique constraint on (mailbox_id, provider_message_id) is the whole
-- idempotency story. A provider that redelivers the same message, a retried
-- sync, two overlapping runs: all of them collide here, at the database, where
-- it cannot be forgotten by a code path that does not know about it.
--
-- first_seen_at is written once and never touched again. last_seen_at moves.
-- The difference is what lets "we have seen this message four times" be
-- answered without storing it four times.
-- ---------------------------------------------------------------------------
create table public.email_messages (
  id                 uuid primary key default gen_random_uuid(),
  business_unit_id   uuid not null references public.business_units(id),
  mailbox_id         uuid not null references public.mailboxes(id) on delete cascade,
  thread_id          uuid not null references public.email_threads(id) on delete cascade,

  -- Provider identity.
  provider_message_id text not null,
  -- RFC 5322 identity, when the provider gives it to us. Kept alongside rather
  -- than instead of the provider id: they answer different questions, and the
  -- provider id is the one we can rely on being present.
  internet_message_id text,
  in_reply_to         text,
  references_header   text[] not null default '{}',

  from_address       citext not null,
  from_name          text,
  to_addresses       citext[] not null default '{}',
  cc_addresses       citext[] not null default '{}',
  -- Present only when the provider exposes it for a mailbox we own; usually
  -- empty. Stored because a missing Bcc changes what a thread means.
  bcc_addresses      citext[] not null default '{}',

  subject            text,
  snippet            text,
  body_text          text,
  body_html          text,

  sent_at            timestamptz,
  received_at        timestamptz not null,

  -- Selected headers only. The full set lives with the raw message; copying it
  -- all into a jsonb column would duplicate the evidence for no gain.
  headers            jsonb not null default '{}'::jsonb,

  has_attachments    boolean not null default false,
  attachment_count   integer not null default 0,

  -- Reference to the preserved original in private storage, when one was
  -- captured. Null means we hold the normalized form only, which is stated
  -- rather than implied.
  raw_storage_path   text,
  raw_checksum       text,

  source_type        source_kind not null default 'email_event',
  processing_status  email_processing_status not null default 'received',
  processing_error   text,

  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint email_messages_provider_id_present
    check (length(btrim(provider_message_id)) > 0),
  -- A failed message must say why. A silent failure is indistinguishable from
  -- a message nobody has looked at.
  constraint email_messages_failure_is_explained
    check (processing_status <> 'failed' or processing_error is not null),

  unique (mailbox_id, provider_message_id),
  foreign key (thread_id, mailbox_id)
    references public.email_threads (id, mailbox_id),
  unique (id, business_unit_id)
);

-- The four questions the explorer actually asks.
create index email_messages_inbox_idx
  on public.email_messages (mailbox_id, received_at desc);
create index email_messages_thread_idx
  on public.email_messages (thread_id, received_at);
create index email_messages_status_idx
  on public.email_messages (processing_status, received_at desc);
create index email_messages_sent_idx
  on public.email_messages (mailbox_id, sent_at desc);
-- Sender and subject search. Trigram rather than a tsvector: it answers
-- "contains" on short fields without duplicating every body into an index.
-- A tsvector column can be added later without touching these.
create index email_messages_from_trgm
  on public.email_messages using gin ((from_address::text) gin_trgm_ops);
create index email_messages_subject_trgm
  on public.email_messages using gin (subject gin_trgm_ops);
create index email_messages_internet_id_idx
  on public.email_messages (internet_message_id)
  where internet_message_id is not null;

create trigger set_updated_at before update on public.email_messages
  for each row execute function util.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Attachment metadata.
--
-- METADATA. The bytes are fetched only if a later, deliberate step asks for
-- them, and they land in private storage. Nothing here attaches a file to a
-- candidate's documents — that is a verified workflow, and this build has no
-- verification.
-- ---------------------------------------------------------------------------
create table public.email_attachments (
  id                    uuid primary key default gen_random_uuid(),
  business_unit_id      uuid not null references public.business_units(id),
  message_id            uuid not null references public.email_messages(id) on delete cascade,

  provider_attachment_id text,
  file_name             text not null,
  mime_type             text,
  size_bytes            bigint,

  -- Set only if the bytes were actually downloaded.
  storage_path          text,
  checksum_sha256       text,
  downloaded_at         timestamptz,

  created_at            timestamptz not null default now(),

  constraint email_attachments_size_sane
    check (size_bytes is null or size_bytes >= 0),
  -- One row per attachment per message, so a re-sync updates rather than
  -- multiplies.
  unique (message_id, provider_attachment_id),
  foreign key (message_id, business_unit_id)
    references public.email_messages (id, business_unit_id)
);

create index email_attachments_message_idx on public.email_attachments (message_id);

-- ---------------------------------------------------------------------------
-- Sync runs.
--
-- Every attempt is a row, successful or not. cursor_before and cursor_after
-- make "which run moved us, and to where" answerable after the fact, which is
-- the question you have when a mailbox has quietly stopped importing.
-- ---------------------------------------------------------------------------
create table public.mailbox_sync_runs (
  id                uuid primary key default gen_random_uuid(),
  business_unit_id  uuid not null references public.business_units(id),
  mailbox_id        uuid not null references public.mailboxes(id) on delete cascade,

  trigger_kind      email_sync_trigger not null default 'manual',
  status            email_sync_status not null default 'running',

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,

  cursor_before     text,
  cursor_after      text,

  messages_seen     integer not null default 0,
  messages_created  integer not null default 0,
  messages_updated  integer not null default 0,
  attachments_seen  integer not null default 0,

  -- Safe diagnostics only. Never a token, never a raw provider response.
  error_message     text,

  started_by        uuid references public.users(id),
  created_at        timestamptz not null default now(),

  constraint mailbox_sync_runs_failure_is_explained
    check (status <> 'failed' or error_message is not null),
  constraint mailbox_sync_runs_finished_when_closed
    check (status = 'running' or finished_at is not null)
);

create index mailbox_sync_runs_recent_idx
  on public.mailbox_sync_runs (mailbox_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Processing state transitions, made explicit.
--
-- Written as a trigger rather than as a rule the ingestion service remembers,
-- because a state machine enforced only by the code that happens to call it is
-- not a state machine.
-- ---------------------------------------------------------------------------
create or replace function util.tg_guard_email_processing_status()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  if new.processing_status = old.processing_status then
    return new;
  end if;

  v_allowed := case old.processing_status
    when 'received'   then new.processing_status in ('stored', 'failed')
    when 'stored'     then new.processing_status in ('ready', 'failed')
    when 'ready'      then new.processing_status in ('processing', 'failed')
    when 'processing' then new.processing_status in ('ready', 'failed')
    -- A failure can be retried from the beginning, and nothing else.
    when 'failed'     then new.processing_status in ('received', 'stored')
    else false
  end;

  if not v_allowed then
    raise exception 'illegal email processing transition: % -> %',
      old.processing_status, new.processing_status
      using errcode = 'check_violation';
  end if;

  -- Leaving the failed state clears the explanation with it, so a stale reason
  -- cannot hang around on a message that is fine.
  if new.processing_status <> 'failed' then
    new.processing_error := null;
  end if;

  return new;
end;
$$;

create trigger guard_email_processing_status
  before update on public.email_messages
  for each row execute function util.tg_guard_email_processing_status();

-- ---------------------------------------------------------------------------
-- Thread counters, derived rather than maintained by the caller.
-- ---------------------------------------------------------------------------
create or replace function util.tg_email_thread_rollup()
returns trigger
language plpgsql
as $$
begin
  update public.email_threads t
     set message_count    = (select count(*) from public.email_messages m
                              where m.thread_id = t.id),
         first_message_at = (select min(m.received_at) from public.email_messages m
                              where m.thread_id = t.id),
         last_message_at  = (select max(m.received_at) from public.email_messages m
                              where m.thread_id = t.id)
   where t.id = new.thread_id;
  return null;
end;
$$;

create trigger email_thread_rollup
  after insert or update of thread_id, received_at on public.email_messages
  for each row execute function util.tg_email_thread_rollup();

-- ---------------------------------------------------------------------------
-- Audit — the same log, with the content taken out.
--
-- The generic audit.tg_audit_row() stores a full jsonb snapshot of the row in
-- old_data/new_data. On a CRM table that is exactly what you want. On an email
-- table it would copy every body, snippet and header set into the audit log,
-- duplicating the most sensitive content in the product into a second place
-- with different retention and a different read path.
--
-- So these tables get a redacting variant. It records the same event, the same
-- actor and the same CHANGED FIELD NAMES — which is what the audit questions
-- ("who ingested this", "who moved it to failed") actually need — and replaces
-- the content columns with a marker rather than dropping the snapshot
-- entirely, so a reader can tell redaction happened.
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

  -- Everything that could carry message content or a credential. Listed
  -- explicitly: a redaction that works by guessing at column names is one
  -- schema change away from leaking.
  c_redacted constant text[] := array[
    'body_text', 'body_html', 'snippet', 'headers', 'subject',
    'from_address', 'from_name', 'to_addresses', 'cc_addresses', 'bcc_addresses',
    'normalized_subject', 'file_name', 'error_message', 'last_sync_error',
    'processing_error'
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

  -- Replace, do not delete: '[redacted]' says the column existed and was
  -- changed, which a missing key would not.
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

create trigger audit_rows after insert or update or delete on public.mailboxes
  for each row execute function audit.tg_audit_email_row();
create trigger audit_rows after insert or update or delete on public.email_threads
  for each row execute function audit.tg_audit_email_row();
create trigger audit_rows after insert or update or delete on public.email_messages
  for each row execute function audit.tg_audit_email_row();
create trigger audit_rows after insert or update or delete on public.email_attachments
  for each row execute function audit.tg_audit_email_row();
create trigger audit_rows after insert or update or delete on public.mailbox_sync_runs
  for each row execute function audit.tg_audit_email_row();
