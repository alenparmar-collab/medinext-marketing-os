-- ===========================================================================
-- 0016 — Permissions for applications and activities
--
-- Same conventions as 0012: application code checks these capability codes,
-- never role names, so widening a role stays a seed row.
--
-- Recruiters get the working set — read, create and update applications, log
-- activity, write notes. They do NOT get delete: an application is a historical
-- fact, and the ordinary correction is a status change to withdrawn or closed.
-- ===========================================================================

insert into public.permissions (code, domain, description) values
  ('application.view',   'application', 'Read applications within scope.'),
  ('application.create', 'application', 'Record a new application for a candidate.'),
  ('application.update', 'application', 'Edit an application and change its status.'),
  ('application.delete', 'application', 'Delete an application (admin correction of a mistaken entry).'),
  ('activity.view',      'activity',    'Read marketing activity within scope.'),
  ('activity.create',    'activity',    'Record marketing activity manually.'),
  ('activity.verify',    'activity',    'Mark a machine-created record as verified by a human.')
on conflict (code) do update
  set domain = excluded.domain, description = excluded.description;

-- Admin holds everything, including anything added above.
insert into public.role_permissions (role_code, permission_code)
select 'admin', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('manager', 'application.view'),
  ('manager', 'application.create'),
  ('manager', 'application.update'),
  ('manager', 'application.delete'),
  ('manager', 'activity.view'),
  ('manager', 'activity.create'),
  ('manager', 'activity.verify')
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('recruiter', 'application.view'),
  ('recruiter', 'application.create'),
  ('recruiter', 'application.update'),
  ('recruiter', 'activity.view'),
  ('recruiter', 'activity.create')
on conflict do nothing;

-- The candidate role continues to hold no permissions whatsoever. Portal access
-- is a separate RLS path keyed on candidates.user_id, so a mistake in this
-- matrix cannot expose internal data to a candidate.
