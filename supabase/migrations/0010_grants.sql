-- ===========================================================================
-- 0010 — Table privileges
--
-- Supabase's default setup grants public-schema tables to anon as well as
-- authenticated, leaning entirely on RLS. We are stricter: `anon` gets nothing
-- at all, so an unauthenticated request fails on privileges before it ever
-- reaches a policy. RLS remains the boundary for signed-in users; this is a
-- second, coarser gate underneath it.
--
-- These grants are explicit rather than inherited so that a local Postgres and
-- a Supabase project behave identically.
-- ===========================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on
  public.candidates,
  public.candidate_internal_notes,
  public.candidate_assignments,
  public.marketing_periods,
  public.documents
to authenticated;

grant select, insert, update on public.users to authenticated;
grant select, insert, delete on public.user_roles to authenticated;
grant select, insert, delete on public.role_permissions to authenticated;
grant select, insert, update on public.business_units to authenticated;
grant select, insert, update on public.document_types to authenticated;
grant select on public.roles, public.permissions to authenticated;

-- candidates.reference defaults to nextval() on insert.
grant usage on sequence public.candidate_reference_seq to authenticated;

-- The service role bypasses RLS by design; it still needs table privileges.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
