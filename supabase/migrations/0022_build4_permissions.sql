-- ===========================================================================
-- 0022 — Permissions for interviews, assessments and documents
--
-- Same conventions as 0012 and 0016: code checks capability codes, never role
-- names, so widening a role stays a seed row.
--
-- Recruiters manage interviews and assessments for their own candidates —
-- that is the daily work. Deletion stays with managers and admins, because an
-- interview that happened is a historical fact and the ordinary correction is
-- a status change to cancelled.
-- ===========================================================================

insert into public.permissions (code, domain, description) values
  ('interview.view',    'interview',  'Read interviews within scope.'),
  ('interview.manage',  'interview',  'Schedule, reschedule and update interviews.'),
  ('interview.delete',  'interview',  'Delete an interview (admin correction of a mistaken entry).'),
  ('assessment.view',   'assessment', 'Read assessments within scope.'),
  ('assessment.manage', 'assessment', 'Record and update assessments.'),
  ('assessment.delete', 'assessment', 'Delete an assessment (admin correction of a mistaken entry).'),
  ('document.download', 'document',   'Download a candidate document within scope.')
on conflict (code) do update
  set domain = excluded.domain, description = excluded.description;

insert into public.role_permissions (role_code, permission_code)
select 'admin', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('manager', 'interview.view'),
  ('manager', 'interview.manage'),
  ('manager', 'interview.delete'),
  ('manager', 'assessment.view'),
  ('manager', 'assessment.manage'),
  ('manager', 'assessment.delete'),
  ('manager', 'document.download')
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('recruiter', 'interview.view'),
  ('recruiter', 'interview.manage'),
  ('recruiter', 'assessment.view'),
  ('recruiter', 'assessment.manage'),
  ('recruiter', 'document.download')
on conflict do nothing;

-- The candidate role continues to hold NO permissions. Portal access, including
-- the document upload added in 0023, is a separate RLS path keyed on
-- candidates.user_id — so a mistake in this matrix cannot expose internal data.
