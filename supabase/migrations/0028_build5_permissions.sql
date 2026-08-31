-- ===========================================================================
-- 0028 — Permissions for reporting, review and administration
--
-- Same conventions throughout: code checks capability codes, never role names.
--
-- Note what a manager does NOT get: user.manage and role.manage stay with
-- admin. A manager runs the marketing operation; they do not administer
-- accounts, and in particular cannot create an administrator — which migration
-- 0027 now also enforces structurally.
-- ===========================================================================

insert into public.permissions (code, domain, description) values
  ('report.submit_own', 'report', 'Create and confirm your own daily report.'),
  ('report.view_own',   'report', 'Read your own daily reports.'),
  ('report.view_all',   'report', 'Read daily reports across the business unit.'),
  ('review.view',       'review', 'Read the review queue.'),
  ('review.manage',     'review', 'Assign, resolve and dismiss review items, and run the checks.'),
  ('user.view',         'admin',  'Read user accounts in the business unit.')
on conflict (code) do update
  set domain = excluded.domain, description = excluded.description;

insert into public.role_permissions (role_code, permission_code)
select 'admin', code from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('manager', 'report.submit_own'),
  ('manager', 'report.view_own'),
  ('manager', 'report.view_all'),
  ('manager', 'review.view'),
  ('manager', 'review.manage'),
  ('manager', 'user.view')
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('recruiter', 'report.submit_own'),
  ('recruiter', 'report.view_own'),
  ('recruiter', 'review.view')
on conflict do nothing;

-- Recruiters see the queue but do not resolve items: a review item usually
-- exists because something about their own work needs a second pair of eyes.
-- The candidate role continues to hold no permissions whatsoever.
