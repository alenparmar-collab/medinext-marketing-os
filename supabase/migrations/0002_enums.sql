-- ===========================================================================
-- 0002 — Enumerated types
--
-- Enum vs lookup table follows docs/architecture/02 §1: a closed set the code
-- branches on is an enum; anything a non-engineer might reasonably want to
-- extend is a table.
--
-- Widening an enum later is `alter type ... add value` (cheap, non-blocking).
-- Removing or renaming a value is not, which is why anything still uncertain
-- is modelled as a lookup table or free text in this build.
-- ===========================================================================

-- Provenance vocabulary, shared by every record. Build 2 only ever writes
-- 'manual' and 'seed'; the remaining values exist so later builds do not have
-- to alter the type on tables that already carry data.
create type source_kind as enum (
  'manual',
  'seed',
  'excel_import',
  'email_event',
  'system',
  'api'
);

-- The marketing lifecycle, exactly as specified for Build 2. Used by both
-- candidates.marketing_status and marketing_periods.status so the two can
-- never describe the same lifecycle with different words.
create type marketing_status as enum (
  'onboarding',
  'ready_for_marketing',
  'active',
  'paused',
  'completed',
  'on_hold',
  'closed'
);

-- Who a candidate is assigned to, and in what capacity.
-- There is deliberately no sales/salesperson value.
create type assignment_type as enum (
  'primary_recruiter',
  'secondary_recruiter',
  'manager'
);

create type user_status as enum ('invited', 'active', 'suspended', 'disabled');

create type document_visibility as enum ('internal', 'candidate_visible');

create type actor_kind as enum ('user', 'system', 'service', 'anonymous');
