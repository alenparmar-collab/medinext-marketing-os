-- ---------------------------------------------------------------------------
-- MUTATION: grant every internal user the email capability.
--
-- Recruiters holding email.view by default is the change most likely to be
-- made "to be helpful". It gives every recruiter every candidate's
-- correspondence, including candidates they do not work.
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role_code, permission_code)
values ('recruiter', 'email.view')
on conflict do nothing;
