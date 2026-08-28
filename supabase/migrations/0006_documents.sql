-- ===========================================================================
-- 0006 — Candidate documents
--
-- Files live in a PRIVATE Supabase Storage bucket. This table is the metadata
-- and the authorization record; storage.objects policies in 0009 parse the
-- same candidate id out of the object path.
-- ===========================================================================

-- Lookup rather than enum: the business will want to add document types
-- without a migration (docs/architecture/02 §1).
create table public.document_types (
  code                      text primary key,
  label                     text not null,
  candidate_visible_default boolean not null default false,
  is_active                 boolean not null default true,
  sort_order                smallint not null default 0
);

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,

  document_type    text not null references public.document_types(code),
  file_name        text not null check (length(btrim(file_name)) > 0),
  storage_bucket   text not null default 'candidate-documents',
  storage_path     text not null unique,
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes > 0),
  checksum_sha256  text check (checksum_sha256 ~ '^[a-f0-9]{64}$'),

  -- Uploading a file does NOT make it visible to the candidate. Publishing is
  -- a separate, permissioned action (document.set_visibility).
  visibility       document_visibility not null default 'internal',

  version                integer not null default 1 check (version > 0),
  supersedes_document_id uuid references public.documents(id) on delete set null,

  uploaded_by      uuid references public.users(id),
  uploaded_at      timestamptz not null default now(),
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  foreign key (candidate_id, business_unit_id)
    references public.candidates (id, business_unit_id)
);

create index documents_candidate_idx
  on public.documents (candidate_id, uploaded_at desc) where deleted_at is null;
create index documents_visible_idx
  on public.documents (candidate_id) where visibility = 'candidate_visible' and deleted_at is null;

-- The same file uploaded twice against one candidate is a mistake, not a version.
create unique index documents_checksum_uk
  on public.documents (candidate_id, checksum_sha256)
  where deleted_at is null and checksum_sha256 is not null;

create trigger set_updated_at before update on public.documents
  for each row execute function util.tg_set_updated_at();

-- Deferred from 0004: candidates and documents reference each other.
alter table public.candidates
  add constraint candidates_primary_resume_fk
  foreign key (primary_resume_document_id)
  references public.documents(id) on delete set null;

comment on column public.documents.storage_path is
  'Convention: {candidate_id}/{document_type}/{uuid}-{file_name}. The first '
  'path segment is the authorization key parsed by the storage RLS policies.';
