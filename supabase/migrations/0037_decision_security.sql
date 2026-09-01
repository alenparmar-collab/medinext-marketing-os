-- ===========================================================================
-- 0037 — Decision security
--
-- Reviewing a proposal is a new capability. ACTING on one is not: approving a
-- proposed interview requires interview.manage, exactly as creating one by
-- hand does, and that check happens in the same command either way.
--
-- So there are two gates on every approval, and they are different questions:
--
--   proposal.review  — may you work this queue at all?
--   interview.manage — may you create an interview?
--
-- A reviewer holding the first but not the second can read the proposal and
-- reject or ignore it. They cannot approve it into existence, because the
-- command they would have to go through refuses them — the same command, the
-- same policy, the same RLS.
-- ===========================================================================

insert into public.permissions (code, domain, description) values
  ('proposal.review', 'email',
   'Work the proposal queue: read, assign, reject and ignore proposed events.'),
  ('proposal.approve', 'email',
   'Approve a proposed event into a CRM record. Still subject to the '
   'permission for the record being created.')
on conflict (code) do update
  set domain = excluded.domain, description = excluded.description;

insert into public.role_permissions (role_code, permission_code)
select 'admin', code
  from public.permissions
 where code in ('proposal.review', 'proposal.approve')
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code) values
  ('manager', 'proposal.review'),
  ('manager', 'proposal.approve')
on conflict do nothing;

-- Recruiters hold neither by default, matching their access to the mailbox and
-- to interpretation. Granting proposal.review to a recruiter is a seed row and
-- would let them work the queue for the candidates they can already access —
-- RLS on the underlying CRM tables still decides what they can create.

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- Unlike the interpretation runs, review items ARE written through the request
-- path: a person assigns one to themselves, marks it in review, rejects it. So
-- there is an UPDATE grant here — narrowed by policy to holders of
-- proposal.review, and further narrowed by the transition guard.
--
-- INSERT is not granted. Items are created by the decision engine under the
-- service role, because a decision is the engine's to make; a person who could
-- insert one could invent an approval to hang a CRM record from.
-- ---------------------------------------------------------------------------
grant select, update on public.intelligence_review_items to authenticated;
grant all on public.intelligence_review_items to service_role;

alter table public.intelligence_review_items enable row level security;
alter table public.intelligence_review_items force row level security;

create policy intelligence_review_items_select on public.intelligence_review_items
  for select to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('proposal.review'))
    and (select util.in_business_unit(business_unit_id))
  );

create policy intelligence_review_items_update on public.intelligence_review_items
  for update to authenticated
  using (
    (select util.is_internal())
    and (select util.has_permission('proposal.review'))
    and (select util.in_business_unit(business_unit_id))
  )
  with check (
    (select util.is_internal())
    and (select util.has_permission('proposal.review'))
    and (select util.in_business_unit(business_unit_id))
  );

-- No candidate policy of any kind. No INSERT policy. No DELETE policy: review
-- history is never deleted, so "we rejected this in September" stays
-- answerable.

-- ---------------------------------------------------------------------------
-- A guard the policy cannot express.
--
-- The UPDATE policy above lets a reviewer change the row. It cannot tell an
-- approval from a rejection, and approving is the operation that has a second
-- requirement: the CRM permission for the thing being created.
--
-- Belt and braces. The command already checks this before it calls anything,
-- and the CRM command's own RLS would refuse the write regardless — but a
-- review item marked approved by someone who could not have created the record
-- would be a lie in the audit trail, so the database refuses to record it.
-- ---------------------------------------------------------------------------
create or replace function util.tg_guard_proposal_approval_permission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required text;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  -- The engine and the seed run without a session actor.
  if auth.uid() is null then
    return new;
  end if;

  if not util.has_permission('proposal.approve') then
    raise exception 'approving a proposal requires proposal.approve'
      using errcode = '42501';
  end if;

  v_required := case new.event_type
    when 'application'        then 'application.create'
    when 'interview'          then 'interview.manage'
    when 'assessment'         then 'assessment.manage'
    when 'rejection'          then 'application.update'
    else null
  end;

  if v_required is not null and not util.has_permission(v_required) then
    raise exception 'approving a % proposal requires %', new.event_type, v_required
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger guard_proposal_approval_permission
  before update on public.intelligence_review_items
  for each row execute function util.tg_guard_proposal_approval_permission();
