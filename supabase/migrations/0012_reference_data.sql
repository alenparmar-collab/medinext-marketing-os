-- ===========================================================================
-- 0012 — System reference data
--
-- This is SYSTEM data, not demo data: the application cannot function without
-- it, so it ships as a migration rather than a seed. Demo people and
-- candidates live in supabase/seed/demo.sql and never run in production.
--
-- Idempotent throughout, so re-running a migration set is safe.
-- ===========================================================================

insert into public.roles (code, name, description, rank) values
  ('admin',     'Administrator',     'Full system access, including user management, permissions and audit.', 10),
  ('manager',   'Marketing Manager', 'Manages candidates, marketing and team activity across the business unit.', 20),
  ('recruiter', 'Recruiter',         'Works the candidates assigned to them and their marketing activity.', 30),
  ('candidate', 'Candidate',         'Portal access to their own records only.', 40)
on conflict (code) do update
  set name = excluded.name, description = excluded.description, rank = excluded.rank;

insert into public.permissions (code, domain, description) values
  ('candidate.view_all',        'candidate', 'Read every candidate in the business unit.'),
  ('candidate.view_assigned',   'candidate', 'Read candidates assigned to the user.'),
  ('candidate.create',          'candidate', 'Create candidates.'),
  ('candidate.update',          'candidate', 'Update candidates within scope.'),
  ('candidate.archive',         'candidate', 'Archive candidates.'),
  ('candidate.delete',          'candidate', 'Hard-delete a candidate (admin correction only).'),
  ('candidate.assign',          'candidate', 'Create and end candidate assignments.'),
  ('candidate.invite_portal',   'candidate', 'Issue or revoke candidate portal access.'),
  ('note.write',                'candidate', 'Write internal notes on a candidate.'),

  ('marketing_period.view',     'marketing', 'Read marketing periods within scope.'),
  ('marketing_period.manage',   'marketing', 'Open, update and close marketing periods.'),

  ('document.view_internal',    'document',  'Read internal (unpublished) candidate documents.'),
  ('document.upload',           'document',  'Upload candidate documents.'),
  ('document.delete',           'document',  'Delete candidate documents.'),
  ('document.set_visibility',   'document',  'Publish a document to the candidate portal.'),

  ('user.manage',               'admin',     'Create and administer user accounts.'),
  ('role.manage',               'admin',     'Grant and revoke roles.'),
  ('permission.manage',         'admin',     'Edit the role/permission matrix.'),
  ('lookup.manage',             'admin',     'Edit lookup tables such as document types.'),
  ('unit.manage',               'admin',     'Create and administer business units.'),
  ('unit.view_all',             'admin',     'Read across every business unit.'),
  ('audit.read',                'admin',     'Read the audit log.')
on conflict (code) do update
  set domain = excluded.domain, description = excluded.description;

-- ---------------------------------------------------------------------------
-- The default role/permission matrix.
--
-- Cells marked in docs/architecture/03 as open decision D-03 take the
-- conservative reading: a recruiter works their assigned candidates but does
-- not create, assign, archive, publish documents, or administer anything.
-- Widening any of these is a single row here, not a code change.
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role_code, permission_code)
select 'admin', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('manager', 'candidate.view_all'),
  ('manager', 'candidate.view_assigned'),
  ('manager', 'candidate.create'),
  ('manager', 'candidate.update'),
  ('manager', 'candidate.archive'),
  ('manager', 'candidate.assign'),
  ('manager', 'candidate.invite_portal'),
  ('manager', 'note.write'),
  ('manager', 'marketing_period.view'),
  ('manager', 'marketing_period.manage'),
  ('manager', 'document.view_internal'),
  ('manager', 'document.upload'),
  ('manager', 'document.delete'),
  ('manager', 'document.set_visibility')
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('recruiter', 'candidate.view_assigned'),
  ('recruiter', 'candidate.update'),
  ('recruiter', 'note.write'),
  ('recruiter', 'marketing_period.view'),
  ('recruiter', 'marketing_period.manage'),
  ('recruiter', 'document.view_internal'),
  ('recruiter', 'document.upload')
on conflict do nothing;

-- The candidate role deliberately holds NO permissions. Portal access is a
-- separate RLS path keyed on candidates.user_id, so a mistake in this matrix
-- cannot grant a candidate internal data (docs/architecture/03 §2).

insert into public.document_types (code, label, candidate_visible_default, sort_order) values
  ('resume',             'Resume',              true,  10),
  ('formatted_resume',   'Formatted resume',    false, 20),
  ('cover_letter',       'Cover letter',        false, 30),
  ('certification',      'Certification',       true,  40),
  ('education_document', 'Education document',  true,  50),
  ('id_proof',           'Identity document',   false, 60),
  ('work_authorization', 'Work authorization',  false, 70),
  ('other',              'Other',               false, 99)
on conflict (code) do update
  set label = excluded.label, sort_order = excluded.sort_order;
