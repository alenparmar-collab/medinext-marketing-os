-- ===========================================================================
-- 0035 — Intelligence security
--
-- An intelligence run holds an interpretation of an email, which means it
-- holds the email: quoted excerpts, an extracted company and role, a summary,
-- and a named candidate it might be about. It is therefore treated exactly as
-- the mailbox is — candidates have no access of any kind, and internal users
-- need an explicit capability.
--
-- One addition beyond the Build 6 posture: the ability to SPEND MONEY. Running
-- interpretation calls a paid provider, so triggering a run is its own
-- capability, separate from reading the results.
-- ===========================================================================

insert into public.permissions (code, domain, description) values
  ('intelligence.view', 'email',
   'Read email interpretation results and candidate proposals.'),
  ('intelligence.run',  'email',
   'Trigger interpretation of an email, including reprocessing.')
on conflict (code) do update
  set domain = excluded.domain, description = excluded.description;

insert into public.role_permissions (role_code, permission_code)
select 'admin', code
  from public.permissions
 where code in ('intelligence.view', 'intelligence.run')
on conflict do nothing;

-- Managers read and may reprocess; they already hold email.view, and an
-- interpretation reveals nothing about a message they cannot already read.
insert into public.role_permissions (role_code, permission_code) values
  ('manager', 'intelligence.view'),
  ('manager', 'intelligence.run')
on conflict do nothing;

-- Recruiters appear nowhere, for the same reason they hold no email.view: a
-- marketing mailbox has no per-candidate boundary to apply, because nothing
-- has been matched to a candidate yet. Widening this is a seed row once the
-- business decides who should see what.

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- Read-only for internal users. Every run is written by the interpretation
-- service under the service role, so there is no INSERT or UPDATE grant to
-- hand out and no policy that could be widened into one. In particular there
-- is no path by which a request could edit a confidence score.
-- ---------------------------------------------------------------------------
grant select on public.email_intelligence_runs to authenticated;
grant all    on public.email_intelligence_runs to service_role;

alter table public.email_intelligence_runs enable row level security;
alter table public.email_intelligence_runs force row level security;

create policy email_intelligence_runs_select on public.email_intelligence_runs
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('intelligence.view'))
    and (select util.in_business_unit(business_unit_id))
  );

-- No candidate policy of any kind, no INSERT policy, no UPDATE policy, no
-- DELETE policy. The absences are the design: an interpretation that a person
-- can edit is not a record of what the model said.
