-- ===========================================================================
-- 0011 — Storage foundation
--
-- One PRIVATE bucket. There are no public buckets anywhere in this product.
--
-- Object path convention, which the policies below parse:
--     candidate-documents/{candidate_id}/{document_type}/{uuid}-{file_name}
-- The first path segment is the authorization key.
--
-- Guarded so the file applies cleanly to a bare PostgreSQL instance (where the
-- storage schema does not exist) as well as to a Supabase project.
-- ===========================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent — skipping bucket and object policies (local test database)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'candidate-documents',
    'candidate-documents',
    false,
    26214400,  -- 25 MB
    array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg'
    ]
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Internal staff: any candidate they are authorized to access.
  execute $pol$
    create policy documents_read_internal on storage.objects
      for select to authenticated
      using (
        bucket_id = 'candidate-documents'
        and (select util.is_internal())
        and (select util.can_access_candidate(((storage.foldername(name))[1])::uuid))
      )
  $pol$;

  execute $pol$
    create policy documents_write_internal on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'candidate-documents'
        and (select util.has_permission('document.upload'))
        and (select util.can_access_candidate(((storage.foldername(name))[1])::uuid))
      )
  $pol$;

  execute $pol$
    create policy documents_delete_internal on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'candidate-documents'
        and (select util.has_permission('document.delete'))
        and (select util.can_access_candidate(((storage.foldername(name))[1])::uuid))
      )
  $pol$;

  -- Candidates: their own folder AND only files a staff member published.
  -- Both halves matter — the folder check alone would expose internal drafts.
  execute $pol$
    create policy documents_read_own on storage.objects
      for select to authenticated
      using (
        bucket_id = 'candidate-documents'
        and ((storage.foldername(name))[1])::uuid = (select util.own_candidate_id())
        and exists (
          select 1 from public.documents d
          where d.storage_path = storage.objects.name
            and d.visibility = 'candidate_visible'
            and d.deleted_at is null
        )
      )
  $pol$;
end;
$$;
