-- ===========================================================================
-- 0023 — Candidate document upload
--
-- CHANGE TO A PREVIOUSLY RESOLVED DECISION.
--
-- Decision D-01 made the portal strictly read-only, and Builds 2 and 3 held to
-- that: candidates had SELECT policies and nothing else, on any table. The
-- Build 4 brief asks for "candidate upload where permitted", which supersedes
-- it. This migration is the whole of that change, kept in one place so the
-- exception is visible rather than scattered.
--
-- The permission is narrow by construction:
--   * A candidate may INSERT a document row, and only for their own candidate
--     id, and only with visibility 'candidate_visible' — they cannot create an
--     internal-only record, and they cannot see internal documents either way.
--   * They may NOT update or delete any document, including their own. An
--     uploaded file is a submitted fact; withdrawing it is a staff action.
--   * Nothing else about the portal becomes writable.
-- ===========================================================================

create policy documents_insert_own on public.documents
  for insert to authenticated
  with check (
    candidate_id = (select util.own_candidate_id())
    and visibility = 'candidate_visible'
    and uploaded_by = (select auth.uid())
    and deleted_at is null
  );

-- Deliberately absent: documents_update_own and documents_delete_own.

comment on policy documents_insert_own on public.documents is
  'The single portal write path in the product. Supersedes decision D-01 for '
  'candidate document upload only; every other portal table remains read-only.';

-- ---------------------------------------------------------------------------
-- Matching storage policy.
--
-- Guarded exactly as 0011 is, so the file applies cleanly to a bare PostgreSQL
-- instance as well as to a Supabase project.
--
-- Note both halves: the object must sit under the candidate's own folder AND
-- the caller must be that candidate. The metadata row and the object are
-- written in the same server action, so an orphan on either side is a bug the
-- reconciliation job would surface, not a security hole.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema absent — skipping candidate upload policy';
    return;
  end if;

  execute $pol$
    create policy documents_write_own on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'candidate-documents'
        and ((storage.foldername(name))[1])::uuid = (select util.own_candidate_id())
      )
  $pol$;
end;
$$;
