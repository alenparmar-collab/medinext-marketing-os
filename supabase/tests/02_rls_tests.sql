-- ===========================================================================
-- RLS AND AUTHORIZATION TEST SUITE
--
-- Runs against a real PostgreSQL database with the real migrations applied,
-- as the real `authenticated` role, with real JWT claims.
--
-- The single most important assertion in this file is CANDIDATE ISOLATION:
-- Candidate A must not be able to read Candidate B under any query.
-- ===========================================================================

truncate test.results;

\set ADMIN 00000000-0000-4000-8000-000000000001
\set MANAGER 00000000-0000-4000-8000-000000000002
\set SALAS 00000000-0000-4000-8000-000000000003
\set HALVORSEN 00000000-0000-4000-8000-000000000004
\set ROSSI 00000000-0000-4000-8000-000000000005
\set PRIYA_USER 00000000-0000-4000-8000-000000000011
\set LUCIA_USER 00000000-0000-4000-8000-000000000013

\set PRIYA 00000000-0000-4000-a000-000000000001
\set KWAME 00000000-0000-4000-a000-000000000002
\set LUCIA 00000000-0000-4000-a000-000000000003
\set DMITRI 00000000-0000-4000-a000-000000000004
\set NAOMI 00000000-0000-4000-a000-000000000005
\set HIROSHI 00000000-0000-4000-a000-000000000006

\set EU_UNIT 00000000-0000-4000-9000-000000000001

-- Build 3: applications and activities
\set APP_PRIYA_1 00000000-0000-4000-8f00-000000000001
\set APP_LUCIA_1 00000000-0000-4000-8f00-000000000007
\set APP_NAOMI   00000000-0000-4000-8f00-00000000000b
\set APP_HIROSHI 00000000-0000-4000-8f00-00000000000c
\set ACT_NOTE    00000000-0000-4000-9100-000000000006

-- Build 4: interviews, assessments, notifications
\set IV_PRIYA_DONE  00000000-0000-4000-9200-000000000001
\set IV_PRIYA_NEXT  00000000-0000-4000-9200-000000000002
\set IV_LUCIA       00000000-0000-4000-9200-000000000003
\set IV_HIROSHI     00000000-0000-4000-9200-000000000005
\set AS_PRIYA_DONE  00000000-0000-4000-9300-000000000001
\set AS_PRIYA_OPEN  00000000-0000-4000-9300-000000000002
\set AS_LUCIA       00000000-0000-4000-9300-000000000003
\set DOC_PRIYA_PUB  00000000-0000-4000-8d00-000000000001
\set DOC_PRIYA_INT  00000000-0000-4000-8d00-000000000002
\set DOC_LUCIA      00000000-0000-4000-8d00-000000000003

-- Build 5: reports, review queue, administration
\set RPT_SALAS_CONF 00000000-0000-4000-9500-000000000001
\set RPT_SALAS_DRAFT 00000000-0000-4000-9500-000000000003
\set RPT_HALV       00000000-0000-4000-9500-000000000004
\set RPT_ROSSI      00000000-0000-4000-9500-000000000005

-- ---------------------------------------------------------------------------
-- SECTION 1 — Unauthenticated access
-- ---------------------------------------------------------------------------
select test.check('anon', 'anonymous cannot read candidates',
  test.count_anon('select count(*) from public.candidates'), -1::bigint);
select test.check('anon', 'anonymous cannot read users',
  test.count_anon('select count(*) from public.users'), -1::bigint);
select test.check('anon', 'anonymous cannot read documents',
  test.count_anon('select count(*) from public.documents'), -1::bigint);

-- A signed-in role with no matching user row resolves to nothing.
select test.check('anon', 'unknown JWT subject sees no candidates',
  test.count_as('00000000-0000-4000-8000-0000000000ff',
                'select count(*) from public.candidates'), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 2 — Role resolution
-- ---------------------------------------------------------------------------
select test.check('roles', 'admin holds unit.view_all',
  (select count(*) from public.role_permissions
    where role_code='admin' and permission_code='unit.view_all'), 1::bigint);
select test.check('roles', 'manager does not hold unit.view_all',
  (select count(*) from public.role_permissions
    where role_code='manager' and permission_code='unit.view_all'), 0::bigint);
select test.check('roles', 'recruiter cannot create candidates',
  (select count(*) from public.role_permissions
    where role_code='recruiter' and permission_code='candidate.create'), 0::bigint);
select test.check('roles', 'recruiter cannot assign candidates',
  (select count(*) from public.role_permissions
    where role_code='recruiter' and permission_code='candidate.assign'), 0::bigint);
select test.check('roles', 'candidate role holds zero permissions',
  (select count(*) from public.role_permissions where role_code='candidate'), 0::bigint);
select test.check('roles', 'no sales role exists',
  (select count(*) from public.roles where code ilike '%sale%'), 0::bigint);

-- The candidate role is exclusive: granting an internal role alongside it fails.
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.user_roles (user_id, role_code)
    values ('00000000-0000-4000-8000-000000000011', 'recruiter');
  exception when others then
    v_ok := true;
  end;
  insert into test.results (section, name, passed, detail)
  values ('roles', 'candidate role cannot be combined with an internal role', v_ok,
          case when v_ok then 'ok' else 'the grant was accepted' end);
end $$;

-- ---------------------------------------------------------------------------
-- SECTION 3 — Internal read scope
-- ---------------------------------------------------------------------------
select test.check('scope', 'admin sees all 6 candidates across both units',
  test.count_as(:'ADMIN', 'select count(*) from public.candidates'), 6::bigint);

select test.check('scope', 'manager sees the 5 candidates in their own unit',
  test.count_as(:'MANAGER', 'select count(*) from public.candidates'), 5::bigint);

select test.check('scope', 'manager cannot see the other unit''s candidate',
  test.count_as(:'MANAGER',
    'select count(*) from public.candidates where id = ' || quote_literal(:'HIROSHI')), 0::bigint);

-- Compared against the RULE rather than a fixed number: a hardcoded count goes
-- stale whenever the seed grows, and this is the stronger claim anyway — the
-- policy returns exactly the rows an active assignment allows, no more.
select test.check('scope', 'recruiter Salas sees exactly their actively-assigned candidates',
  test.count_as(:'SALAS', 'select count(*) from public.candidates'),
  (select count(distinct ca.candidate_id) from public.candidate_assignments ca
    join public.candidates c on c.id = ca.candidate_id
   where ca.user_id = '00000000-0000-4000-8000-000000000003'
     and ca.ends_on is null and c.archived_at is null));

select test.check('scope', 'recruiter Halvorsen sees exactly their actively-assigned candidates',
  test.count_as(:'HALVORSEN', 'select count(*) from public.candidates'),
  (select count(distinct ca.candidate_id) from public.candidate_assignments ca
    join public.candidates c on c.id = ca.candidate_id
   where ca.user_id = '00000000-0000-4000-8000-000000000004'
     and ca.ends_on is null and c.archived_at is null));

select test.check('scope', 'recruiter cannot see a candidate assigned to a colleague',
  test.count_as(:'SALAS',
    'select count(*) from public.candidates where id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('scope', 'recruiter cannot see the unassigned candidate',
  test.count_as(:'SALAS',
    'select count(*) from public.candidates where id = ' || quote_literal(:'NAOMI')), 0::bigint);

select test.check('scope', 'manager CAN see the unassigned candidate',
  test.count_as(:'MANAGER',
    'select count(*) from public.candidates where id = ' || quote_literal(:'NAOMI')), 1::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 4 — Cross-tenant isolation (decision D-13)
-- ---------------------------------------------------------------------------
select test.check('tenancy', 'APAC recruiter sees only their own unit''s candidate',
  test.count_as(:'ROSSI', 'select count(*) from public.candidates'), 1::bigint);

select test.check('tenancy', 'APAC recruiter cannot see any EU candidate',
  test.count_as(:'ROSSI',
    'select count(*) from public.candidates where business_unit_id = ' || quote_literal(:'EU_UNIT')), 0::bigint);

select test.check('tenancy', 'EU manager cannot see APAC marketing periods',
  test.count_as(:'MANAGER',
    'select count(*) from public.marketing_periods where candidate_id = ' || quote_literal(:'HIROSHI')), 0::bigint);

select test.check('tenancy', 'EU manager cannot see APAC documents',
  test.count_as(:'MANAGER',
    'select count(*) from public.documents where candidate_id = ' || quote_literal(:'HIROSHI')), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 5 — CANDIDATE ISOLATION  ***the critical assertion***
-- ---------------------------------------------------------------------------
select test.check('isolation', 'candidate Priya sees exactly one candidate row',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.candidates'), 1::bigint);

select test.check('isolation', 'candidate Priya sees HER OWN row',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.candidates where id = ' || quote_literal(:'PRIYA')), 1::bigint);

select test.check('isolation', 'CANDIDATE A CANNOT READ CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.candidates where id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('isolation', 'candidate B cannot read candidate A (reverse direction)',
  test.count_as(:'LUCIA_USER',
    'select count(*) from public.candidates where id = ' || quote_literal(:'PRIYA')), 0::bigint);

select test.check('isolation', 'candidate cannot enumerate candidates by email',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.candidates where email like ''%demo.medinext.test'''), 1::bigint);

select test.check('isolation', 'candidate cannot read another candidate''s marketing periods',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.marketing_periods where candidate_id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('isolation', 'candidate sees their own marketing periods (2, incl. closed)',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.marketing_periods'), 2::bigint);

select test.check('isolation', 'candidate cannot read internal notes about themselves',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.candidate_internal_notes'), 0::bigint);

select test.check('isolation', 'candidate cannot read who is assigned to them',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.candidate_assignments'), 0::bigint);

select test.check('isolation', 'candidate cannot enumerate staff accounts',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.users'), 1::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 6 — Document authorization
-- ---------------------------------------------------------------------------
select test.check('documents', 'internal recruiter sees both of Priya''s documents',
  test.count_as(:'SALAS',
    'select count(*) from public.documents where candidate_id = ' || quote_literal(:'PRIYA')), 2::bigint);

select test.check('documents', 'candidate sees ONLY the published document, not the internal one',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.documents'), 1::bigint);

select test.check('documents', 'candidate cannot see the internal-visibility document',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.documents where visibility = ''internal'''), 0::bigint);

select test.check('documents', 'candidate cannot see another candidate''s published document',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.documents where candidate_id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('documents', 'recruiter cannot see documents of an unassigned candidate',
  test.count_as(:'SALAS',
    'select count(*) from public.documents where candidate_id = ' || quote_literal(:'LUCIA')), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 7 — Write authorization
-- ---------------------------------------------------------------------------
select test.check('writes', 'recruiter CANNOT create a candidate (lacks candidate.create)',
  test.write_denied(:'SALAS',
    'insert into public.candidates (business_unit_id, full_name, email) values ('
    || quote_literal(:'EU_UNIT') || ', ''Should Not Exist'', ''nope@demo.medinext.test'')'), true);

select test.check('writes', 'manager CAN create a candidate',
  test.write_allowed(:'MANAGER',
    'insert into public.candidates (business_unit_id, full_name, email) values ('
    || quote_literal(:'EU_UNIT') || ', ''Seeded By Manager'', ''manager.created@demo.medinext.test'')'), true);

select test.check('writes', 'recruiter CAN update their assigned candidate',
  test.write_allowed(:'SALAS',
    'update public.candidates set current_location = ''Leeds, UK'' where id = ' || quote_literal(:'PRIYA')), true);

select test.check('writes', 'recruiter CANNOT update a candidate assigned to a colleague',
  test.write_denied(:'SALAS',
    'update public.candidates set current_location = ''Hacked'' where id = ' || quote_literal(:'LUCIA')), true);

select test.check('writes', 'recruiter CANNOT update the unassigned candidate',
  test.write_denied(:'SALAS',
    'update public.candidates set current_location = ''Hacked'' where id = ' || quote_literal(:'NAOMI')), true);

select test.check('writes', 'CANDIDATE CANNOT UPDATE THEIR OWN RECORD (portal is read-only)',
  test.write_denied(:'PRIYA_USER',
    'update public.candidates set full_name = ''Renamed'' where id = ' || quote_literal(:'PRIYA')), true);

select test.check('writes', 'candidate cannot update another candidate',
  test.write_denied(:'PRIYA_USER',
    'update public.candidates set full_name = ''Renamed'' where id = ' || quote_literal(:'LUCIA')), true);

select test.check('writes', 'candidate cannot insert a candidate',
  test.write_denied(:'PRIYA_USER',
    'insert into public.candidates (business_unit_id, full_name, email) values ('
    || quote_literal(:'EU_UNIT') || ', ''Injected'', ''injected@demo.medinext.test'')'), true);

select test.check('writes', 'candidate cannot delete their own record',
  test.write_denied(:'PRIYA_USER',
    'delete from public.candidates where id = ' || quote_literal(:'PRIYA')), true);

select test.check('writes', 'candidate cannot grant themselves a role',
  test.write_denied(:'PRIYA_USER',
    'insert into public.user_roles (user_id, role_code) values (' || quote_literal(:'PRIYA_USER') || ', ''admin'')'), true);

select test.check('writes', 'recruiter cannot grant themselves a role',
  test.write_denied(:'SALAS',
    'insert into public.user_roles (user_id, role_code) values (' || quote_literal(:'SALAS') || ', ''admin'')'), true);

select test.check('writes', 'recruiter cannot edit the permission matrix',
  test.write_denied(:'SALAS',
    'insert into public.role_permissions (role_code, permission_code) values (''recruiter'', ''candidate.view_all'')'), true);

select test.check('writes', 'recruiter cannot assign a candidate to themselves',
  test.write_denied(:'SALAS',
    'insert into public.candidate_assignments (business_unit_id, candidate_id, user_id) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'NAOMI') || ', ' || quote_literal(:'SALAS') || ')'), true);

select test.check('writes', 'recruiter cannot write a candidate into another business unit',
  test.write_denied(:'SALAS',
    'update public.candidates set current_location = ''Hacked'' where id = ' || quote_literal(:'HIROSHI')), true);

select test.check('writes', 'candidate cannot publish a document to themselves',
  test.write_denied(:'PRIYA_USER',
    'update public.documents set visibility = ''candidate_visible'' where visibility = ''internal'''), true);

-- ---------------------------------------------------------------------------
-- SECTION 8 — Audit
-- ---------------------------------------------------------------------------
select test.check('audit', 'audit rows were written by the seed inserts',
  (select count(*) > 0 from audit.audit_logs where entity_type = 'candidates'), true);

select test.check('audit', 'the recruiter update above produced an audit row with the actor',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'candidates'
      and action = 'update'
      and actor_id = '00000000-0000-4000-8000-000000000003'
      and 'current_location' = any(changed_fields)), true);

select test.check('audit', 'audit rows capture both old and new data on update',
  (select count(*) > 0 from audit.audit_logs
    where action = 'update' and old_data is not null and new_data is not null), true);

select test.check('audit', 'authenticated users cannot read the audit log',
  test.count_as(:'ADMIN', 'select count(*) from audit.audit_logs'), -1::bigint);

do $$
declare v_denied boolean := false;
begin
  begin
    update audit.audit_logs set action = 'tampered' where id = (select min(id) from audit.audit_logs);
  exception when others then
    v_denied := true;
  end;
  insert into test.results (section, name, passed, detail)
  values ('audit', 'audit log rejects UPDATE even as superuser', v_denied,
          case when v_denied then 'ok' else 'the update was accepted' end);
end $$;

do $$
declare v_denied boolean := false;
begin
  begin
    delete from audit.audit_logs where id = (select min(id) from audit.audit_logs);
  exception when others then
    v_denied := true;
  end;
  insert into test.results (section, name, passed, detail)
  values ('audit', 'audit log rejects DELETE even as superuser', v_denied,
          case when v_denied then 'ok' else 'the delete was accepted' end);
end $$;

-- ===========================================================================
-- BUILD 3 — Applications, activities, timeline
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SECTION 11 — Internal scope over applications
-- ---------------------------------------------------------------------------
select test.check('applications', 'admin sees every application in both units',
  test.count_as(:'ADMIN', 'select count(*) from public.applications'),
  (select count(*) from public.applications));

select test.check('applications', 'manager sees exactly their own unit''s applications',
  test.count_as(:'MANAGER', 'select count(*) from public.applications'),
  (select count(*) from public.applications
    where business_unit_id = '00000000-0000-4000-9000-000000000001'));

select test.check('applications', 'recruiter Salas sees exactly their assigned candidates'' applications',
  test.count_as(:'SALAS', 'select count(*) from public.applications'),
  (select count(*) from public.applications a
   where a.candidate_id in (
     select ca.candidate_id from public.candidate_assignments ca
     where ca.user_id = '00000000-0000-4000-8000-000000000003' and ca.ends_on is null)));

select test.check('applications', 'recruiter Halvorsen sees exactly their assigned candidates'' applications',
  test.count_as(:'HALVORSEN', 'select count(*) from public.applications'),
  (select count(*) from public.applications a
   where a.candidate_id in (
     select ca.candidate_id from public.candidate_assignments ca
     where ca.user_id = '00000000-0000-4000-8000-000000000004' and ca.ends_on is null)));

select test.check('applications', 'recruiter cannot see an application on an unassigned candidate',
  test.count_as(:'SALAS',
    'select count(*) from public.applications where id = ' || quote_literal(:'APP_NAOMI')), 0::bigint);

select test.check('applications', 'manager CAN see the unassigned candidate''s application',
  test.count_as(:'MANAGER',
    'select count(*) from public.applications where id = ' || quote_literal(:'APP_NAOMI')), 1::bigint);

select test.check('applications', 'recruiter cannot see a colleague''s candidate''s application',
  test.count_as(:'SALAS',
    'select count(*) from public.applications where id = ' || quote_literal(:'APP_LUCIA_1')), 0::bigint);

select test.check('applications', 'cross-unit: EU manager cannot see the APAC application',
  test.count_as(:'MANAGER',
    'select count(*) from public.applications where id = ' || quote_literal(:'APP_HIROSHI')), 0::bigint);

select test.check('applications', 'cross-unit: APAC recruiter sees only their own unit''s application',
  test.count_as(:'ROSSI', 'select count(*) from public.applications'), 1::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 12 — CANDIDATE ISOLATION over applications  ***critical***
-- ---------------------------------------------------------------------------
select test.check('isolation', 'candidate Priya sees exactly her own applications and no others',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.applications'),
  (select count(*) from public.applications
    where candidate_id = '00000000-0000-4000-a000-000000000001'));

select test.check('isolation', 'CANDIDATE A CANNOT READ APPLICATIONS OF CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.applications where candidate_id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('isolation', 'candidate B cannot read candidate A''s applications (reverse)',
  test.count_as(:'LUCIA_USER',
    'select count(*) from public.applications where candidate_id = ' || quote_literal(:'PRIYA')), 0::bigint);

select test.check('isolation', 'candidate cannot read a named application belonging to another candidate',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.applications where id = ' || quote_literal(:'APP_LUCIA_1')), 0::bigint);

select test.check('isolation', 'candidate cannot enumerate applications by company name',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.applications where company_name is not null'),
  (select count(*) from public.applications
    where candidate_id = '00000000-0000-4000-a000-000000000001'));

select test.check('isolation', 'candidate cannot read application status history',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.application_status_history'), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 13 — CANDIDATE ISOLATION over activities  ***critical***
-- ---------------------------------------------------------------------------
select test.check('isolation', 'CANDIDATE A CANNOT READ ACTIVITIES OF CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.marketing_activities where candidate_id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('isolation', 'candidate B cannot read candidate A''s activities (reverse)',
  test.count_as(:'LUCIA_USER',
    'select count(*) from public.marketing_activities where candidate_id = ' || quote_literal(:'PRIYA')), 0::bigint);

select test.check('isolation', 'CANDIDATE CANNOT READ INTERNAL NOTE ACTIVITIES',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.marketing_activities where activity_type = ''note'''), 0::bigint);

select test.check('isolation', 'candidate cannot read the seeded internal note activity by id',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.marketing_activities where id = ' || quote_literal(:'ACT_NOTE')), 0::bigint);

select test.check('isolation', 'candidate sees no internal-visibility activity at all',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.marketing_activities where visibility = ''internal'''), 0::bigint);

select test.check('isolation', 'internal staff DO see the internal note activity',
  test.count_as(:'SALAS',
    'select count(*) from public.marketing_activities where id = ' || quote_literal(:'ACT_NOTE')), 1::bigint);

-- The visibility trigger is a structural guarantee, not a convention.
do $$
declare v_vis text;
begin
  insert into public.marketing_activities
    (id, business_unit_id, candidate_id, activity_type, summary, visibility, created_by)
  values ('00000000-0000-4000-9100-0000000000ff',
          '00000000-0000-4000-9000-000000000001',
          '00000000-0000-4000-a000-000000000001',
          'note', 'attempted candidate-visible note', 'candidate_visible',
          '00000000-0000-4000-8000-000000000003');

  select visibility into v_vis from public.marketing_activities
   where id = '00000000-0000-4000-9100-0000000000ff';

  insert into test.results (section, name, passed, detail)
  values ('isolation', 'a note forced candidate_visible is coerced back to internal',
          v_vis = 'internal', coalesce('visibility=' || v_vis, 'null'));
end $$;

-- ---------------------------------------------------------------------------
-- SECTION 14 — Write authorization on applications and activities
-- ---------------------------------------------------------------------------
select test.check('writes', 'recruiter CAN create an application for their candidate',
  test.write_allowed(:'SALAS',
    'insert into public.applications (business_unit_id, candidate_id, company_name, position_title) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA')
    || ', ''Test Co'', ''Test Role'')'), true);

select test.check('writes', 'recruiter CANNOT create an application for a colleague''s candidate',
  test.write_denied(:'SALAS',
    'insert into public.applications (business_unit_id, candidate_id, company_name, position_title) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'LUCIA')
    || ', ''Should Fail'', ''Test Role'')'), true);

select test.check('writes', 'recruiter CANNOT create an application in another business unit',
  test.write_denied(:'SALAS',
    'insert into public.applications (business_unit_id, candidate_id, company_name, position_title) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'HIROSHI')
    || ', ''Should Fail'', ''Test Role'')'), true);

select test.check('writes', 'recruiter CAN update their candidate''s application status',
  test.write_allowed(:'SALAS',
    'update public.applications set status = ''screening'' where id = ' || quote_literal(:'APP_PRIYA_1')), true);

select test.check('writes', 'recruiter CANNOT update a colleague''s candidate''s application',
  test.write_denied(:'SALAS',
    'update public.applications set status = ''closed'' where id = ' || quote_literal(:'APP_LUCIA_1')), true);

select test.check('writes', 'recruiter CANNOT delete an application (lacks application.delete)',
  test.write_denied(:'SALAS',
    'delete from public.applications where id = ' || quote_literal(:'APP_PRIYA_1')), true);

select test.check('writes', 'CANDIDATE CANNOT CREATE AN APPLICATION',
  test.write_denied(:'PRIYA_USER',
    'insert into public.applications (business_unit_id, candidate_id, company_name, position_title) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA')
    || ', ''Self Added'', ''Role'')'), true);

select test.check('writes', 'CANDIDATE CANNOT EDIT THEIR OWN APPLICATION',
  test.write_denied(:'PRIYA_USER',
    'update public.applications set status = ''offer'' where id = ' || quote_literal(:'APP_PRIYA_1')), true);

select test.check('writes', 'candidate cannot delete their own application',
  test.write_denied(:'PRIYA_USER',
    'delete from public.applications where id = ' || quote_literal(:'APP_PRIYA_1')), true);

select test.check('writes', 'CANDIDATE CANNOT CREATE MARKETING ACTIVITY',
  test.write_denied(:'PRIYA_USER',
    'insert into public.marketing_activities (business_unit_id, candidate_id, activity_type, summary) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA')
    || ', ''interview'', ''Self logged'')'), true);

select test.check('writes', 'candidate cannot make an internal activity visible to themselves',
  test.write_denied(:'PRIYA_USER',
    'update public.marketing_activities set visibility = ''candidate_visible'' where visibility = ''internal'''), true);

select test.check('writes', 'candidate cannot forge application status history',
  test.write_denied(:'PRIYA_USER',
    'insert into public.application_status_history (application_id, to_status) values ('
    || quote_literal(:'APP_PRIYA_1') || ', ''offer'')'), true);

select test.check('writes', 'nobody can edit status history, not even a manager',
  test.write_denied(:'MANAGER',
    'update public.application_status_history set to_status = ''offer'''), true);

select test.check('writes', 'nobody can delete status history, not even a manager',
  test.write_denied(:'MANAGER',
    'delete from public.application_status_history'), true);

select test.check('writes', 'recruiter CAN log a manual activity for their candidate',
  test.write_allowed(:'SALAS',
    'insert into public.marketing_activities (business_unit_id, candidate_id, activity_type, summary) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA')
    || ', ''follow_up'', ''Called the vendor'')'), true);

-- ---------------------------------------------------------------------------
-- SECTION 15 — Automation produced the derived records
-- ---------------------------------------------------------------------------
select test.check('automation', 'every application has an opening status-history row',
  (select count(*) from public.applications a
    where not exists (
      select 1 from public.application_status_history h
       where h.application_id = a.id and h.from_status is null)), 0::bigint);

select test.check('automation', 'every application produced an application_submitted activity',
  (select count(*) from public.applications a
    where not exists (
      select 1 from public.marketing_activities m
       where m.application_id = a.id and m.activity_type = 'application_submitted')), 0::bigint);

select test.check('automation', 'the recruiter status change above wrote a history row',
  (select count(*) > 0 from public.application_status_history
    where application_id = '00000000-0000-4000-8f00-000000000001'
      and to_status = 'screening'
      and changed_by = '00000000-0000-4000-8000-000000000003'), true);

select test.check('automation', 'the recruiter status change above wrote a status_change activity',
  (select count(*) > 0 from public.marketing_activities
    where application_id = '00000000-0000-4000-8f00-000000000001'
      and activity_type = 'status_change'), true);

select test.check('automation', 'application changes are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'applications' and action = 'update'
      and actor_id = '00000000-0000-4000-8000-000000000003'), true);

select test.check('automation', 'activity inserts are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'marketing_activities' and action = 'insert'), true);

-- ---------------------------------------------------------------------------
-- SECTION 16 — Derived counts and timeline respect RLS
-- ---------------------------------------------------------------------------
select test.check('aggregation', 'counts are derived from records, not stored totals',
  test.count_as(:'SALAS',
    'select applications from public.candidate_counts(array[' || quote_literal(:'PRIYA') || ']::uuid[])'),
  (select count(*) from public.applications
    where candidate_id = '00000000-0000-4000-a000-000000000001'));

select test.check('aggregation', 'a recruiter gets zero counts for a candidate they cannot access',
  test.count_as(:'SALAS',
    'select coalesce((select applications from public.candidate_counts(array['
    || quote_literal(:'LUCIA') || ']::uuid[])), 0)'), 0::bigint);

select test.check('aggregation', 'interview counts come from activity records',
  test.count_as(:'HALVORSEN',
    'select interviews from public.candidate_counts(array[' || quote_literal(:'LUCIA') || ']::uuid[])'),
  1::bigint);

select test.check('timeline', 'internal staff see the internal note on the timeline',
  test.count_as(:'SALAS',
    'select count(*) from public.candidate_timeline(' || quote_literal(:'PRIYA')
    || ') where entry_kind = ''note'' and entry_id = ' || quote_literal(:'ACT_NOTE')),
  1::bigint);

select test.check('timeline', 'CANDIDATE TIMELINE EXCLUDES INTERNAL NOTES',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.candidate_timeline(' || quote_literal(:'PRIYA') || ') where entry_kind = ''note'''),
  0::bigint);

select test.check('timeline', 'candidate sees their own timeline entries',
  (test.count_as(:'PRIYA_USER',
    'select count(*) from public.candidate_timeline(' || quote_literal(:'PRIYA') || ')') > 0), true);

select test.check('timeline', 'CANDIDATE A GETS NOTHING FROM THE TIMELINE OF CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.candidate_timeline(' || quote_literal(:'LUCIA') || ')'), 0::bigint);

select test.check('timeline', 'a recruiter gets nothing from an unassigned candidate''s timeline',
  test.count_as(:'SALAS',
    'select count(*) from public.candidate_timeline(' || quote_literal(:'NAOMI') || ')'), 0::bigint);

-- ===========================================================================
-- BUILD 4 — Interviews, assessments, notifications, documents
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SECTION 17 — Internal scope over interviews and assessments
-- ---------------------------------------------------------------------------
select test.check('interviews', 'admin sees every interview across both units',
  test.count_as(:'ADMIN', 'select count(*) from public.interviews'),
  (select count(*) from public.interviews));

select test.check('interviews', 'manager sees their unit''s interviews only',
  test.count_as(:'MANAGER', 'select count(*) from public.interviews'),
  (select count(*) from public.interviews where business_unit_id = :'EU_UNIT'::uuid));

select test.check('interviews', 'recruiter Salas sees only his assigned candidates'' interviews',
  test.count_as(:'SALAS', 'select count(*) from public.interviews'),
  (select count(*) from public.interviews i
    where exists (
      select 1 from public.candidate_assignments ca
      where ca.candidate_id = i.candidate_id
        and ca.user_id = :'SALAS'::uuid and ca.ends_on is null)));

select test.check('interviews', 'RECRUITER CANNOT ACCESS AN UNAUTHORIZED CANDIDATE INTERVIEW',
  test.count_as(:'SALAS',
    'select count(*) from public.interviews where id = ' || quote_literal(:'IV_LUCIA')), 0::bigint);

select test.check('interviews', 'cross-unit: EU manager cannot see the APAC interview',
  test.count_as(:'MANAGER',
    'select count(*) from public.interviews where id = ' || quote_literal(:'IV_HIROSHI')), 0::bigint);

select test.check('assessments', 'admin sees every assessment across both units',
  test.count_as(:'ADMIN', 'select count(*) from public.assessments'),
  (select count(*) from public.assessments));

select test.check('assessments', 'recruiter Salas sees only his assigned candidates'' assessments',
  test.count_as(:'SALAS', 'select count(*) from public.assessments'),
  (select count(*) from public.assessments s
    where exists (
      select 1 from public.candidate_assignments ca
      where ca.candidate_id = s.candidate_id
        and ca.user_id = :'SALAS'::uuid and ca.ends_on is null)));

select test.check('assessments', 'RECRUITER CANNOT ACCESS AN UNAUTHORIZED CANDIDATE ASSESSMENT',
  test.count_as(:'SALAS',
    'select count(*) from public.assessments where id = ' || quote_literal(:'AS_LUCIA')), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 18 — CANDIDATE ISOLATION on the new records  ***critical***
-- ---------------------------------------------------------------------------
select test.check('isolation', 'candidate Priya sees her own interviews and no others',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.interviews'),
  (select count(*) from public.interviews where candidate_id = :'PRIYA'::uuid));

select test.check('isolation', 'CANDIDATE A CANNOT READ INTERVIEWS OF CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.interviews where candidate_id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('isolation', 'candidate B cannot read interviews of candidate A (reverse)',
  test.count_as(:'LUCIA_USER',
    'select count(*) from public.interviews where candidate_id = ' || quote_literal(:'PRIYA')), 0::bigint);

select test.check('isolation', 'candidate cannot read a named interview of another candidate',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.interviews where id = ' || quote_literal(:'IV_LUCIA')), 0::bigint);

select test.check('isolation', 'CANDIDATE A CANNOT READ ASSESSMENTS OF CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.assessments where candidate_id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('isolation', 'candidate B cannot read assessments of candidate A (reverse)',
  test.count_as(:'LUCIA_USER',
    'select count(*) from public.assessments where candidate_id = ' || quote_literal(:'PRIYA')), 0::bigint);

select test.check('isolation', 'candidate cannot read interview scheduling history',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.interview_schedule_history'), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 19 — Notifications
-- ---------------------------------------------------------------------------
select test.check('notifications', 'the candidate received notifications for their own events',
  (test.count_as(:'PRIYA_USER', 'select count(*) from public.notifications') > 0), true);

select test.check('notifications', 'CANDIDATE A CANNOT READ NOTIFICATIONS OF CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.notifications where recipient_id = ' || quote_literal(:'LUCIA_USER')),
  0::bigint);

select test.check('notifications', 'candidate B cannot read notifications of candidate A (reverse)',
  test.count_as(:'LUCIA_USER',
    'select count(*) from public.notifications where recipient_id = ' || quote_literal(:'PRIYA_USER')),
  0::bigint);

select test.check('notifications', 'even an admin cannot read another user''s notifications',
  test.count_as(:'ADMIN',
    'select count(*) from public.notifications where recipient_id <> ' || quote_literal(:'ADMIN')),
  0::bigint);

select test.check('notifications', 'the assigned recruiter was notified too',
  (test.count_as(:'SALAS', 'select count(*) from public.notifications') > 0), true);

select test.check('notifications', 'an unrelated recruiter was not notified about this candidate',
  test.count_as(:'ROSSI',
    'select count(*) from public.notifications where entity_id = ' || quote_literal(:'IV_PRIYA_NEXT')),
  0::bigint);

select test.check('notifications', 'CANDIDATE CANNOT CREATE A NOTIFICATION',
  test.write_denied(:'PRIYA_USER',
    'insert into public.notifications (business_unit_id, recipient_id, notification_type, title, dedupe_key) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA_USER')
    || ', ''important_marketing_update'', ''Forged'', ''forged:1'')'), true);

select test.check('notifications', 'a recruiter cannot create a notification directly either',
  test.write_denied(:'SALAS',
    'insert into public.notifications (business_unit_id, recipient_id, notification_type, title, dedupe_key) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'SALAS')
    || ', ''important_marketing_update'', ''Forged'', ''forged:2'')'), true);

select test.check('notifications', 'a candidate CAN mark their own notification read',
  test.write_allowed(:'PRIYA_USER',
    'update public.notifications set read_at = now() where read_at is null'), true);

select test.check('notifications', 'a candidate cannot mark another user''s notification read',
  test.write_denied(:'PRIYA_USER',
    'update public.notifications set read_at = now() where recipient_id = ' || quote_literal(:'LUCIA_USER')),
  true);

-- Idempotency: re-observing the SAME event must not produce a second
-- notification.
--
-- This has to reach the emit path to prove anything. A no-op update returns
-- early from the notify trigger, so instead the interview is moved to a new
-- time, moved away, and moved BACK to the first time — which regenerates the
-- identical dedupe key, exactly as a retried email job would.
do $$
declare
  v_original timestamptz;
  v_before bigint;
  v_after  bigint;
begin
  select scheduled_at into v_original from public.interviews
   where id = '00000000-0000-4000-9200-000000000003';

  -- First observation of "rescheduled to T1".
  update public.interviews set scheduled_at = v_original + interval '1 day'
   where id = '00000000-0000-4000-9200-000000000003';

  -- Counted for ONE recipient, because the dedupe index is scoped per
  -- recipient and the audience is several people.
  select count(*) into v_before from public.notifications
   where entity_id = '00000000-0000-4000-9200-000000000003'
     and recipient_id = '00000000-0000-4000-8000-000000000013';

  -- Move away, then back to T1: the dedupe key for T1 repeats.
  update public.interviews set scheduled_at = v_original + interval '2 days'
   where id = '00000000-0000-4000-9200-000000000003';
  update public.interviews set scheduled_at = v_original + interval '1 day'
   where id = '00000000-0000-4000-9200-000000000003';

  select count(*) into v_after from public.notifications
   where entity_id = '00000000-0000-4000-9200-000000000003'
     and recipient_id = '00000000-0000-4000-8000-000000000013';

  -- The move to T2 legitimately adds one. Returning to T1 must add nothing.
  insert into test.results (section, name, passed, detail)
  values ('notifications', 'DUPLICATE NOTIFICATIONS ARE PREVENTED FOR A REPEATED EVENT',
          v_after = v_before + 1, format('before %s, after %s (expected +1 only)', v_before, v_after));
end $$;

-- ---------------------------------------------------------------------------
-- SECTION 20 — Write authorization on interviews and assessments
-- ---------------------------------------------------------------------------
select test.check('writes', 'recruiter CAN schedule an interview for their candidate',
  test.write_allowed(:'SALAS',
    'insert into public.interviews (business_unit_id, candidate_id, application_id, scheduled_at) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA') || ', '
    || quote_literal(:'APP_PRIYA_1') || ', now() + interval ''3 days'')'), true);

select test.check('writes', 'recruiter CANNOT schedule an interview for a colleague''s candidate',
  test.write_denied(:'SALAS',
    'insert into public.interviews (business_unit_id, candidate_id, application_id, scheduled_at) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'LUCIA') || ', '
    || quote_literal(:'APP_LUCIA_1') || ', now())'), true);

select test.check('writes', 'CANDIDATE CANNOT MODIFY AN INTERVIEW',
  test.write_denied(:'PRIYA_USER',
    'update public.interviews set scheduled_at = now() where id = ' || quote_literal(:'IV_PRIYA_NEXT')),
  true);

select test.check('writes', 'candidate cannot cancel their own interview',
  test.write_denied(:'PRIYA_USER',
    'update public.interviews set status = ''cancelled'' where id = ' || quote_literal(:'IV_PRIYA_NEXT')),
  true);

select test.check('writes', 'candidate cannot create an interview',
  test.write_denied(:'PRIYA_USER',
    'insert into public.interviews (business_unit_id, candidate_id, application_id) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA') || ', '
    || quote_literal(:'APP_PRIYA_1') || ')'), true);

select test.check('writes', 'CANDIDATE CANNOT MODIFY AN ASSESSMENT',
  test.write_denied(:'PRIYA_USER',
    'update public.assessments set status = ''passed'' where id = ' || quote_literal(:'AS_PRIYA_OPEN')),
  true);

select test.check('writes', 'candidate cannot create an assessment',
  test.write_denied(:'PRIYA_USER',
    'insert into public.assessments (business_unit_id, candidate_id, application_id, assessment_type) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA') || ', '
    || quote_literal(:'APP_PRIYA_1') || ', ''Self added'')'), true);

select test.check('writes', 'CANDIDATE CANNOT CREATE AN INTERNAL NOTE',
  test.write_denied(:'PRIYA_USER',
    'insert into public.candidate_internal_notes (business_unit_id, candidate_id, body, created_by) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA') || ', ''Injected'', '
    || quote_literal(:'PRIYA_USER') || ')'), true);

select test.check('writes', 'CANDIDATE CANNOT READ THE AUDIT LOG',
  test.count_as(:'PRIYA_USER', 'select count(*) from audit.audit_logs'), -1::bigint);

select test.check('writes', 'recruiter CANNOT delete an interview (lacks interview.delete)',
  test.write_denied(:'SALAS',
    'delete from public.interviews where id = ' || quote_literal(:'IV_PRIYA_DONE')), true);

select test.check('writes', 'nobody can edit interview scheduling history',
  test.write_denied(:'MANAGER',
    'update public.interview_schedule_history set reason = ''rewritten'''), true);

select test.check('writes', 'nobody can delete interview scheduling history',
  test.write_denied(:'MANAGER', 'delete from public.interview_schedule_history'), true);

-- ---------------------------------------------------------------------------
-- SECTION 21 — CROSS-CANDIDATE RELATIONSHIP ATTACK
--
-- The composite foreign key must make it structurally impossible to attach a
-- record to one candidate while pointing at another candidate's application,
-- even for a user authorised on BOTH candidates.
-- ---------------------------------------------------------------------------
do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.interviews (business_unit_id, candidate_id, application_id)
    values ('00000000-0000-4000-9000-000000000001',
            '00000000-0000-4000-a000-000000000001',   -- Priya
            '00000000-0000-4000-8f00-000000000007');  -- Lucia's application
  exception when others then
    v_blocked := true;
  end;
  insert into test.results (section, name, passed, detail)
  values ('integrity', 'INTERVIEW CANNOT BE ATTACHED ACROSS CANDIDATES', v_blocked,
          case when v_blocked then 'ok' else 'the mismatched insert was accepted' end);
end $$;

do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.assessments (business_unit_id, candidate_id, application_id, assessment_type)
    values ('00000000-0000-4000-9000-000000000001',
            '00000000-0000-4000-a000-000000000001',
            '00000000-0000-4000-8f00-000000000007', 'Cross attach');
  exception when others then
    v_blocked := true;
  end;
  insert into test.results (section, name, passed, detail)
  values ('integrity', 'ASSESSMENT CANNOT BE ATTACHED ACROSS CANDIDATES', v_blocked,
          case when v_blocked then 'ok' else 'the mismatched insert was accepted' end);
end $$;

do $$
declare v_blocked boolean := false;
begin
  begin
    update public.interviews
       set candidate_id = '00000000-0000-4000-a000-000000000003'
     where id = '00000000-0000-4000-9200-000000000001';
  exception when others then
    v_blocked := true;
  end;
  insert into test.results (section, name, passed, detail)
  values ('integrity', 'an interview cannot be moved to another candidate', v_blocked,
          case when v_blocked then 'ok' else 'the reassignment was accepted' end);
end $$;

-- ---------------------------------------------------------------------------
-- SECTION 22 — Scheduling history is preserved
-- ---------------------------------------------------------------------------
select test.check('history', 'the seeded reschedule wrote a history row',
  (select count(*) from public.interview_schedule_history
    where interview_id = '00000000-0000-4000-9200-000000000002'
      and change_kind = 'rescheduled'), 1::bigint);

select test.check('history', 'THE ORIGINAL SCHEDULED TIME IS STILL RECOVERABLE',
  (select count(*) > 0 from public.interview_schedule_history
    where interview_id = '00000000-0000-4000-9200-000000000002'
      and change_kind = 'rescheduled'
      and previous_scheduled_at is not null
      and previous_scheduled_at <> new_scheduled_at), true);

select test.check('history', 'the reason given for the move was kept',
  (select count(*) > 0 from public.interview_schedule_history
    where interview_id = '00000000-0000-4000-9200-000000000002'
      and change_kind = 'rescheduled' and reason is not null), true);

select test.check('history', 'every interview has an opening history row',
  (select count(*) from public.interviews i
    where not exists (
      select 1 from public.interview_schedule_history h
       where h.interview_id = i.id and h.change_kind = 'scheduled')), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 23 — Activity mirroring stays idempotent
-- ---------------------------------------------------------------------------
select test.check('automation', 'every interview has exactly one mirroring activity',
  (select count(*) from public.interviews i
    where (select count(*) from public.marketing_activities m where m.interview_id = i.id) <> 1),
  0::bigint);

select test.check('automation', 'every assessment has exactly one mirroring activity',
  (select count(*) from public.assessments a
    where (select count(*) from public.marketing_activities m where m.assessment_id = a.id) <> 1),
  0::bigint);

select test.check('automation', 'interview changes are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs where entity_type = 'interviews'), true);

select test.check('automation', 'assessment changes are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs where entity_type = 'assessments'), true);

select test.check('automation', 'notification creation is captured in the audit log',
  (select count(*) > 0 from audit.audit_logs where entity_type = 'notifications'), true);

select test.check('automation', 'schedule history changes are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs where entity_type = 'interview_schedule_history'), true);

-- ---------------------------------------------------------------------------
-- SECTION 24 — DOCUMENT STORAGE POLICIES
--
-- These run against real storage.objects rows and the real policies from 0011
-- and 0023, so the download guarantee is executed rather than asserted.
-- ---------------------------------------------------------------------------
select test.check('storage', 'internal recruiter can read their candidate''s stored files',
  test.count_as(:'SALAS',
    'select count(*) from storage.objects where bucket_id = ''candidate-documents'''), 2::bigint);

select test.check('storage', 'RECRUITER CANNOT READ FILES OF AN UNAUTHORIZED CANDIDATE',
  test.count_as(:'SALAS',
    'select count(*) from storage.objects where name like ' || quote_literal(:'LUCIA') || ' || ''/%'''),
  0::bigint);

select test.check('storage', 'candidate can read only their own PUBLISHED file',
  test.count_as(:'PRIYA_USER',
    'select count(*) from storage.objects where bucket_id = ''candidate-documents'''), 1::bigint);

select test.check('storage', 'CANDIDATE A CANNOT READ STORED FILES OF CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from storage.objects where name like ' || quote_literal(:'LUCIA') || ' || ''/%'''),
  0::bigint);

select test.check('storage', 'candidate cannot read an internal-only file of their own',
  test.count_as(:'PRIYA_USER',
    'select count(*) from storage.objects where name like ''%formatted_resume%'''), 0::bigint);

select test.check('storage', 'candidate CAN upload into their own folder',
  test.write_allowed(:'PRIYA_USER',
    'insert into storage.objects (bucket_id, name) values (''candidate-documents'', '
    || quote_literal(:'PRIYA') || ' || ''/resume/uploaded-by-candidate.pdf'')'), true);

select test.check('storage', 'CANDIDATE CANNOT UPLOAD INTO ANOTHER CANDIDATE''S FOLDER',
  test.write_denied(:'PRIYA_USER',
    'insert into storage.objects (bucket_id, name) values (''candidate-documents'', '
    || quote_literal(:'LUCIA') || ' || ''/resume/planted.pdf'')'), true);

select test.check('storage', 'candidate cannot delete a stored file',
  test.write_denied(:'PRIYA_USER',
    'delete from storage.objects where bucket_id = ''candidate-documents'''), true);

select test.check('storage', 'anonymous callers hold no storage privileges',
  test.count_anon('select count(*) from storage.objects'), -1::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 25 — Document metadata authorization
-- ---------------------------------------------------------------------------
select test.check('documents', 'CANDIDATE A CANNOT READ DOCUMENT METADATA OF CANDIDATE B',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.documents where candidate_id = ' || quote_literal(:'LUCIA')), 0::bigint);

select test.check('documents', 'candidate CAN record an upload of their own',
  test.write_allowed(:'PRIYA_USER',
    'insert into public.documents (business_unit_id, candidate_id, document_type, file_name, '
    || 'storage_path, mime_type, size_bytes, visibility, uploaded_by) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA')
    || ', ''resume'', ''my-cv.pdf'', ' || quote_literal(:'PRIYA')
    || ' || ''/resume/my-cv.pdf'', ''application/pdf'', 1024, ''candidate_visible'', '
    || quote_literal(:'PRIYA_USER') || ')'), true);

select test.check('documents', 'candidate CANNOT record an upload against another candidate',
  test.write_denied(:'PRIYA_USER',
    'insert into public.documents (business_unit_id, candidate_id, document_type, file_name, '
    || 'storage_path, mime_type, size_bytes, visibility, uploaded_by) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'LUCIA')
    || ', ''resume'', ''planted.pdf'', ''planted/path.pdf'', ''application/pdf'', 1024, '
    || '''candidate_visible'', ' || quote_literal(:'PRIYA_USER') || ')'), true);

select test.check('documents', 'candidate cannot upload an INTERNAL-visibility document',
  test.write_denied(:'PRIYA_USER',
    'insert into public.documents (business_unit_id, candidate_id, document_type, file_name, '
    || 'storage_path, mime_type, size_bytes, visibility, uploaded_by) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA')
    || ', ''resume'', ''sneaky.pdf'', ''sneaky/path.pdf'', ''application/pdf'', 1024, '
    || '''internal'', ' || quote_literal(:'PRIYA_USER') || ')'), true);

select test.check('documents', 'candidate cannot publish an internal document to themselves',
  test.write_denied(:'PRIYA_USER',
    'update public.documents set visibility = ''candidate_visible'' where visibility = ''internal'''),
  true);

select test.check('documents', 'candidate cannot delete a document',
  test.write_denied(:'PRIYA_USER',
    'delete from public.documents where candidate_id = ' || quote_literal(:'PRIYA')), true);

-- ===========================================================================
-- BUILD 5 — Daily reports, review queue, administration
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SECTION 26 — Daily report figures are DERIVED, never stored input
-- ---------------------------------------------------------------------------
select test.check('reports', 'the derived count matches the actual application rows',
  (select applications from public.daily_report_metrics(
     '00000000-0000-4000-8000-000000000003', current_date - 3)),
  (select count(*) from public.applications
    where responsible_recruiter_id = '00000000-0000-4000-8000-000000000003'
      and application_date = current_date - 3));

select test.check('reports', 'the derived response count matches the actual activity rows',
  (select recruiter_responses from public.daily_report_metrics(
     '00000000-0000-4000-8000-000000000003', current_date - 3)),
  (select count(*) from public.marketing_activities
    where responsible_recruiter_id = '00000000-0000-4000-8000-000000000003'
      and activity_type = 'recruiter_response'
      and (activity_date at time zone 'UTC')::date = current_date - 3));

-- The assertion that makes the two rules above non-vacuous: the seed contains
-- records Salas owns but did not create, so counting keystrokes gives a
-- different, smaller answer than counting responsibility.
select test.check('reports', 'ATTRIBUTION BY OWNERSHIP DIFFERS FROM ATTRIBUTION BY CREATOR',
  (select applications from public.daily_report_metrics(
     '00000000-0000-4000-8000-000000000003', current_date - 3))
   > (select count(*) from public.applications
       where created_by = '00000000-0000-4000-8000-000000000003'
         and application_date = current_date - 3), true);

select test.check('reports', 'a draft carries no snapshot at all',
  (select count(*) from public.daily_reports
    where status = 'draft' and snapshot_taken_at is not null), 0::bigint);

select test.check('reports', 'every confirmed report records who confirmed it and when',
  (select count(*) from public.daily_reports
    where status = 'confirmed' and (confirmed_by is null or confirmed_at is null)), 0::bigint);

-- Confirmation must be a reconciliation, not an edit: it may not touch a source
-- record.
do $$
declare v_before bigint; v_after bigint; v_report uuid;
begin
  select count(*) into v_before from public.applications;

  -- Re-runnable: the mutation harness executes this file a second time against
  -- an already-seeded database, and a unique violation here would abort the
  -- block and silently drop the assertions below it.
  delete from public.daily_reports
   where recruiter_id = '00000000-0000-4000-8000-000000000004'
     and report_date = current_date - 5;

  insert into public.daily_reports (business_unit_id, recruiter_id, report_date, status)
  values ('00000000-0000-4000-9000-000000000001',
          '00000000-0000-4000-8000-000000000004', current_date - 5, 'draft')
  returning id into v_report;

  perform set_config('app.actor_id', '00000000-0000-4000-8000-000000000004', true);
  perform public.confirm_daily_report(v_report, 'Confirmed by the test.');
  perform set_config('app.actor_id', '', true);

  select count(*) into v_after from public.applications;

  insert into test.results (section, name, passed, detail)
  values ('reports', 'CONFIRMING A REPORT DOES NOT ALTER SOURCE RECORDS',
          v_before = v_after, format('applications before %s, after %s', v_before, v_after));
end $$;

-- Checked AFTER a report has been confirmed inside this run, so the assertion
-- covers the confirmation path as it currently behaves rather than only the
-- rows the seed left behind.
select test.check('reports', 'A CONFIRMED SNAPSHOT EQUALS THE DERIVED FIGURES',
  (select count(*) from public.daily_reports r
    cross join lateral public.daily_report_metrics(r.recruiter_id, r.report_date) m
   where r.status = 'confirmed'
     and (r.snapshot_applications        is distinct from m.applications
       or r.snapshot_recruiter_responses is distinct from m.recruiter_responses
       or r.snapshot_interviews          is distinct from m.interviews
       or r.snapshot_assessments         is distinct from m.assessments
       or r.snapshot_rejections          is distinct from m.rejections)),
  0::bigint);

-- Re-confirming must be refused rather than taking a second snapshot.
do $$
declare v_refused boolean := false;
begin
  begin
    perform public.confirm_daily_report('00000000-0000-4000-9500-000000000001');
  exception when others then
    v_refused := true;
  end;
  insert into test.results (section, name, passed, detail)
  values ('reports', 'a confirmed report cannot be confirmed twice', v_refused,
          case when v_refused then 'ok' else 'the second confirmation was accepted' end);
end $$;

-- ---------------------------------------------------------------------------
-- SECTION 27 — Report visibility
-- ---------------------------------------------------------------------------
select test.check('reports', 'recruiter Salas sees only their own reports',
  test.count_as(:'SALAS', 'select count(*) from public.daily_reports'), 3::bigint);

select test.check('reports', 'RECRUITER CANNOT READ THE REPORT OF ANOTHER RECRUITER',
  test.count_as(:'SALAS',
    'select count(*) from public.daily_reports where id = ' || quote_literal(:'RPT_HALV')), 0::bigint);

select test.check('reports', 'manager sees the whole unit''s reports',
  (test.count_as(:'MANAGER', 'select count(*) from public.daily_reports') >= 5), true);

select test.check('reports', 'cross-unit: EU manager cannot see the APAC report',
  test.count_as(:'MANAGER',
    'select count(*) from public.daily_reports where id = ' || quote_literal(:'RPT_ROSSI')), 0::bigint);

select test.check('reports', 'CANDIDATE CANNOT ACCESS DAILY REPORTS',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.daily_reports'), 0::bigint);

select test.check('reports', 'candidate cannot read a named internal report',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.daily_reports where id = ' || quote_literal(:'RPT_SALAS_CONF')), 0::bigint);

select test.check('reports', 'CANDIDATE CANNOT CREATE A DAILY REPORT',
  test.write_denied(:'PRIYA_USER',
    'insert into public.daily_reports (business_unit_id, recruiter_id, report_date) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA_USER') || ', current_date)'), true);

select test.check('reports', 'recruiter cannot file a report in someone else''s name',
  test.write_denied(:'SALAS',
    'insert into public.daily_reports (business_unit_id, recruiter_id, report_date) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'HALVORSEN') || ', current_date - 9)'), true);

select test.check('reports', 'recruiter CAN file their own report',
  test.write_allowed(:'SALAS',
    'insert into public.daily_reports (business_unit_id, recruiter_id, report_date, notes) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'SALAS')
    || ', current_date - 8, ''Filed by the test.'')'), true);

select test.check('reports', 'A CONFIRMED REPORT CANNOT BE EDITED',
  test.write_denied(:'SALAS',
    'update public.daily_reports set notes = ''rewritten'' where id = ' || quote_literal(:'RPT_SALAS_CONF')),
  true);

select test.check('reports', 'a draft CAN still be edited by its author',
  test.write_allowed(:'SALAS',
    'update public.daily_reports set notes = ''updated'' where id = ' || quote_literal(:'RPT_SALAS_DRAFT')),
  true);

select test.check('reports', 'nobody can delete a daily report',
  test.write_denied(:'MANAGER', 'delete from public.daily_reports'), true);

-- ---------------------------------------------------------------------------
-- SECTION 28 — Review queue
-- ---------------------------------------------------------------------------
select test.check('review', 'the checks generated items from real records',
  (select count(*) > 0 from public.review_items), true);

do $$
declare v_before bigint; v_after bigint;
begin
  -- Two runs back to back, so nothing else in the suite can create a record
  -- between them. Earlier assertions add applications, and a genuinely new
  -- finding SHOULD produce a new item — that is not a duplicate.
  perform public.run_review_checks('00000000-0000-4000-9000-000000000001');
  select count(*) into v_before from public.review_items;

  perform public.run_review_checks('00000000-0000-4000-9000-000000000001');
  select count(*) into v_after from public.review_items;

  insert into test.results (section, name, passed, detail)
  values ('review', 'RE-RUNNING THE CHECKS CREATES NO DUPLICATES',
          v_before = v_after, format('before %s, after %s', v_before, v_after));
end $$;

select test.check('review', 'items use neutral language, never accusation',
  (select count(*) from public.review_items
    where reason ~* '(fraud|false|misconduct|wrongdoing|lying|dishonest|cheat)'), 0::bigint);

select test.check('review', 'REVIEW QUEUE IS INTERNAL ONLY — candidate sees nothing',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.review_items'), 0::bigint);

select test.check('review', 'candidate B also sees nothing in the review queue',
  test.count_as(:'LUCIA_USER', 'select count(*) from public.review_items'), 0::bigint);

select test.check('review', 'CANDIDATE CANNOT CREATE A REVIEW ITEM',
  test.write_denied(:'PRIYA_USER',
    'insert into public.review_items (business_unit_id, item_type, reason, dedupe_key) values ('
    || quote_literal(:'EU_UNIT') || ', ''missing_information'', ''Injected'', ''injected:1'')'), true);

select test.check('review', 'internal staff can read the queue',
  (test.count_as(:'MANAGER', 'select count(*) from public.review_items') > 0), true);

select test.check('review', 'recruiter can read the queue but not resolve items',
  test.write_denied(:'SALAS',
    'update public.review_items set status = ''dismissed'', resolution = ''no_action_needed'', '
    || 'resolved_by = ' || quote_literal(:'SALAS') || ', resolved_at = now()'), true);

select test.check('review', 'manager CAN resolve a review item',
  test.write_allowed(:'MANAGER',
    'update public.review_items set status = ''resolved'', resolution = ''confirmed_correct'', '
    || 'resolution_notes = ''Checked.'', resolved_by = ' || quote_literal(:'MANAGER')
    || ', resolved_at = now() where status = ''open'''), true);

select test.check('review', 'REVIEW HISTORY CANNOT BE DELETED',
  test.write_denied(:'MANAGER', 'delete from public.review_items'), true);

select test.check('review', 'an admin cannot delete review history either',
  test.write_denied(:'ADMIN', 'delete from public.review_items'), true);

select test.check('review', 'a resolved item must record who resolved it',
  (select count(*) from public.review_items
    where status in ('resolved','dismissed')
      and (resolved_by is null or resolved_at is null or resolution is null)), 0::bigint);

select test.check('review', 'cross-unit: EU manager cannot see APAC review items',
  test.count_as(:'MANAGER',
    'select count(*) from public.review_items where business_unit_id <> ' || quote_literal(:'EU_UNIT')),
  0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 29 — Administration and role escalation
-- ---------------------------------------------------------------------------
select test.check('admin', 'RECRUITER CANNOT ADMINISTER USERS',
  test.write_denied(:'SALAS',
    'update public.users set status = ''disabled'' where id = ' || quote_literal(:'HALVORSEN')), true);

select test.check('admin', 'MANAGER CANNOT ADMINISTER USERS',
  test.write_denied(:'MANAGER',
    'update public.users set status = ''disabled'' where id = ' || quote_literal(:'SALAS')), true);

select test.check('admin', 'admin CAN deactivate a user',
  test.write_allowed(:'ADMIN',
    'update public.users set status = ''suspended'' where id = ' || quote_literal(:'ROSSI')), true);

select test.check('admin', 'admin CAN reactivate a user',
  test.write_allowed(:'ADMIN',
    'update public.users set status = ''active'' where id = ' || quote_literal(:'ROSSI')), true);

select test.check('admin', 'RECRUITER CANNOT CHANGE ROLES',
  test.write_denied(:'SALAS',
    'insert into public.user_roles (user_id, role_code) values (' || quote_literal(:'SALAS') || ', ''manager'')'),
  true);

select test.check('admin', 'MANAGER CANNOT GRANT ANY ROLE',
  test.write_denied(:'MANAGER',
    'insert into public.user_roles (user_id, role_code) values (' || quote_literal(:'HALVORSEN') || ', ''manager'')'),
  true);

select test.check('admin', 'MANAGER CANNOT CREATE AN ADMIN',
  test.write_denied(:'MANAGER',
    'insert into public.user_roles (user_id, role_code) values (' || quote_literal(:'MANAGER') || ', ''admin'')'),
  true);

select test.check('admin', 'a recruiter cannot change their own account status',
  test.write_denied(:'SALAS',
    'update public.users set status = ''suspended'' where id = ' || quote_literal(:'SALAS')), true);

-- Hardening from migration 0027: a user editing their own row may not touch
-- the columns that govern access.
do $$
declare v_blocked boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    -- Must be a genuine change: setting a column to the value it already holds
    -- is not a change, and the guard is right not to fire on one.
    update public.users set status = 'suspended'
     where id = '00000000-0000-4000-8000-000000000003';
  exception when others then
    v_blocked := true;
  end;
  execute 'reset role';

  insert into test.results (section, name, passed, detail)
  values ('admin', 'A USER CANNOT CHANGE THEIR OWN ACCOUNT STATUS', v_blocked,
          case when v_blocked then 'ok' else 'the self-update was accepted' end);
end $$;

do $$
declare v_blocked boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.users set business_unit_id = '00000000-0000-4000-9000-000000000002'
     where id = '00000000-0000-4000-8000-000000000003';
  exception when others then
    v_blocked := true;
  end;
  execute 'reset role';

  insert into test.results (section, name, passed, detail)
  values ('admin', 'A USER CANNOT MOVE THEMSELVES TO ANOTHER BUSINESS UNIT', v_blocked,
          case when v_blocked then 'ok' else 'the self-update was accepted' end);
end $$;

select test.check('admin', 'CANDIDATE CANNOT MAKE THEMSELVES AN INTERNAL USER',
  test.write_denied(:'PRIYA_USER',
    'insert into public.user_roles (user_id, role_code) values (' || quote_literal(:'PRIYA_USER') || ', ''recruiter'')'),
  true);

select test.check('admin', 'candidate cannot grant themselves admin',
  test.write_denied(:'PRIYA_USER',
    'insert into public.user_roles (user_id, role_code) values (' || quote_literal(:'PRIYA_USER') || ', ''admin'')'),
  true);

select test.check('admin', 'candidate cannot enumerate staff accounts',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.users'), 1::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 30 — Candidate assignments
-- ---------------------------------------------------------------------------
select test.check('assignments', 'the seeded reassignment kept the previous assignment row',
  (select count(*) from public.candidate_assignments
    where candidate_id = '00000000-0000-4000-a000-000000000004'), 2::bigint);

select test.check('assignments', 'ASSIGNMENT HISTORY RECORDS WHO ENDED IT AND WHEN',
  (select count(*) > 0 from public.candidate_assignments
    where candidate_id = '00000000-0000-4000-a000-000000000004'
      and ends_on is not null and ended_by is not null), true);

select test.check('assignments', 'exactly one assignment is active after reassignment',
  (select count(*) from public.candidate_assignments
    where candidate_id = '00000000-0000-4000-a000-000000000004' and ends_on is null), 1::bigint);

select test.check('assignments', 'RECRUITER CANNOT ASSIGN THEMSELVES A CANDIDATE',
  test.write_denied(:'SALAS',
    'insert into public.candidate_assignments (business_unit_id, candidate_id, user_id) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'NAOMI') || ', ' || quote_literal(:'SALAS') || ')'),
  true);

select test.check('assignments', 'manager CAN assign a recruiter',
  test.write_allowed(:'MANAGER',
    'insert into public.candidate_assignments (business_unit_id, candidate_id, user_id, assignment_type) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'NAOMI') || ', '
    || quote_literal(:'HALVORSEN') || ', ''primary_recruiter'')'), true);

select test.check('assignments', 'candidate cannot assign anybody',
  test.write_denied(:'PRIYA_USER',
    'insert into public.candidate_assignments (business_unit_id, candidate_id, user_id) values ('
    || quote_literal(:'EU_UNIT') || ', ' || quote_literal(:'PRIYA') || ', ' || quote_literal(:'PRIYA_USER') || ')'),
  true);

-- Hardening from 0027: a portal account is not an assignable recruiter.
do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.candidate_assignments (business_unit_id, candidate_id, user_id)
    values ('00000000-0000-4000-9000-000000000001',
            '00000000-0000-4000-a000-000000000005',
            '00000000-0000-4000-8000-000000000011');   -- Priya's portal account
  exception when others then
    v_blocked := true;
  end;
  insert into test.results (section, name, passed, detail)
  values ('assignments', 'A CANDIDATE ACCOUNT CANNOT BE ASSIGNED AS A RECRUITER', v_blocked,
          case when v_blocked then 'ok' else 'the assignment was accepted' end);
end $$;

select test.check('assignments', 'assignment changes are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'candidate_assignments' and action in ('insert','update')), true);

-- ---------------------------------------------------------------------------
-- SECTION 31 — Audit coverage for the new surfaces
-- ---------------------------------------------------------------------------
select test.check('audit', 'daily report confirmation is captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'daily_reports' and action = 'update'), true);

select test.check('audit', 'review item creation is captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'review_items' and action = 'insert'), true);

select test.check('audit', 'review item resolution is captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'review_items' and action = 'update'), true);

select test.check('audit', 'user status changes are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'users' and action = 'update'
      and 'status' = any(changed_fields)), true);

select test.check('audit', 'CANDIDATE STILL CANNOT READ THE AUDIT LOG',
  test.count_as(:'PRIYA_USER', 'select count(*) from audit.audit_logs'), -1::bigint);

select test.check('audit', 'a recruiter cannot read the audit log either',
  test.count_as(:'SALAS', 'select count(*) from audit.audit_logs'), -1::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 9 — Assignment lifecycle drives access
-- ---------------------------------------------------------------------------
update public.candidate_assignments
   set ends_on = current_date
 where candidate_id = '00000000-0000-4000-a000-000000000002'
   and user_id = '00000000-0000-4000-8000-000000000003';

select test.check('lifecycle', 'ending an assignment revokes the recruiter''s access immediately',
  test.count_as(:'SALAS',
    'select count(*) from public.candidates where id = ' || quote_literal(:'KWAME')), 0::bigint);

select test.check('lifecycle', 'the ended assignment row is retained for audit',
  (select count(*) from public.candidate_assignments
    where candidate_id = '00000000-0000-4000-a000-000000000002'
      and user_id = '00000000-0000-4000-8000-000000000003'), 1::bigint);

update public.users set status = 'disabled'
 where id = '00000000-0000-4000-8000-000000000011';

select test.check('lifecycle', 'disabling a portal user cuts their access immediately',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.candidates'), 0::bigint);

update public.users set status = 'active'
 where id = '00000000-0000-4000-8000-000000000011';

update public.candidates set archived_at = now()
 where id = '00000000-0000-4000-a000-000000000001';

select test.check('lifecycle', 'archiving a candidate cuts their portal access',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.candidates'), 0::bigint);

update public.candidates set archived_at = null
 where id = '00000000-0000-4000-a000-000000000001';

-- ---------------------------------------------------------------------------
-- SECTION 10 — Structural guarantees
--
-- These are generated from the catalogue rather than hand-listed, so a table
-- added in a later build fails the suite until it is classified.
-- ---------------------------------------------------------------------------
select test.check('structure', 'every public table has RLS enabled',
  (select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0::bigint);

select test.check('structure', 'every public table has RLS forced',
  (select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity), 0::bigint);

select test.check('structure', 'every public table carrying candidate data has a SELECT policy',
  (select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not exists (
       select 1 from pg_policy p where p.polrelid = c.oid and p.polcmd in ('r','*')
     )), 0::bigint);

select test.check('structure', 'anon holds no privileges on any public table',
  (select count(*) from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'), 0::bigint);

select test.check('structure', 'every business table carries business_unit_id',
  (select count(*) from (values
     ('candidates'),('candidate_assignments'),('marketing_periods'),
     ('documents'),('candidate_internal_notes'),
     ('applications'),('marketing_activities'),
     ('interviews'),('assessments'),('notifications'),
     ('daily_reports'),('review_items'),
     ('mailboxes'),('email_threads'),('email_messages'),
     ('email_attachments'),('mailbox_sync_runs'),
     ('email_intelligence_runs')) as t(tbl)
   where not exists (
     select 1 from information_schema.columns
      where table_schema='public' and table_name=t.tbl and column_name='business_unit_id'
   )), 0::bigint);

select test.check('structure', 'every audited business table has the audit trigger',
  (select count(*) from (values
     ('candidates'),('candidate_assignments'),('marketing_periods'),
     ('documents'),('users'),('user_roles'),('candidate_internal_notes'),
     ('applications'),('marketing_activities'),('application_status_history'),
     ('interviews'),('assessments'),('notifications'),
     ('interview_schedule_history'),('daily_reports'),('review_items'),
     ('mailboxes'),('email_threads'),('email_messages'),
     ('email_attachments'),('mailbox_sync_runs'),
     ('email_intelligence_runs')) as t(tbl)
   where not exists (
     select 1 from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname=t.tbl and tg.tgname='audit_rows'
   )), 0::bigint);

select test.check('structure', 'no policy calls a helper unwrapped (per-row evaluation)',
  (select count(*) from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || coalesce(with_check,'')) ~ '[^(]util\.(can_access|has_permission|is_internal|in_business_unit|own_candidate)'
      and (coalesce(qual,'') || coalesce(with_check,'')) !~ 'SELECT'), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 32 — Atomic reassignment (0029)
--
-- The transfer must be all-or-nothing. A partial transfer leaves the candidate
-- with nobody working their file, which is worse than the change not happening.
--
-- Written to be re-runnable: the mutation harness runs this suite twice, and a
-- block that assumes a starting state aborts on the second pass and silently
-- drops every assertion below it. So the starting state is established here,
-- and the target is whichever recruiter is NOT currently holding the file.
-- ---------------------------------------------------------------------------
do $$
declare
  c_lucia     constant uuid := '00000000-0000-4000-a000-000000000003';
  -- APAC. Salas can neither read nor write anything of Hiroshi's, which is
  -- what makes him the right subject for a cross-candidate grab. Lucia is
  -- not: section 32 transfers her, so who owns her depends on run order.
  c_hiroshi   constant uuid := '00000000-0000-4000-a000-000000000006';
  c_apac      constant uuid := '00000000-0000-4000-9000-000000000002';
  c_eu_unit   constant uuid := '00000000-0000-4000-9000-000000000001';
  c_manager   constant uuid := '00000000-0000-4000-8000-000000000002';
  c_salas     constant uuid := '00000000-0000-4000-8000-000000000003';
  c_halvorsen constant uuid := '00000000-0000-4000-8000-000000000004';

  v_holder        uuid;
  v_target        uuid;
  v_previous_id   uuid;
  v_new_id        uuid;
  v_before_active bigint;
  v_after_active  bigint;
  v_before_total  bigint;
  v_after_total   bigint;
  v_blocked       boolean := false;
begin
  -- Establish the precondition rather than assuming it: an earlier lifecycle
  -- test may have ended this candidate's assignment.
  select id, user_id into v_previous_id, v_holder
    from public.candidate_assignments
   where candidate_id = c_lucia and assignment_type = 'primary_recruiter'
     and ends_on is null;

  if v_previous_id is null then
    insert into public.candidate_assignments
      (business_unit_id, candidate_id, user_id, assignment_type, created_by)
    values (c_eu_unit, c_lucia, c_halvorsen, 'primary_recruiter', c_manager)
    returning id, user_id into v_previous_id, v_holder;
  end if;

  v_target := case when v_holder = c_salas then c_halvorsen else c_salas end;

  select count(*) filter (where ends_on is null), count(*)
    into v_before_active, v_before_total
    from public.candidate_assignments
   where candidate_id = c_lucia and assignment_type = 'primary_recruiter';

  -- A recruiter holds no candidate.assign, so the transfer must fail outright.
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_salas, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reassign_candidate(c_lucia, v_target);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  insert into test.results (section, name, passed, detail)
  values ('assignments', 'A RECRUITER CANNOT TRANSFER A CANDIDATE TO ANOTHER RECRUITER',
          v_blocked, case when v_blocked then 'ok' else 'the transfer was accepted' end);

  select count(*) filter (where ends_on is null)
    into v_after_active
    from public.candidate_assignments
   where candidate_id = c_lucia and assignment_type = 'primary_recruiter';

  -- The refusal must leave nothing behind: no half-closed assignment.
  insert into test.results (section, name, passed, detail)
  values ('assignments', 'A REFUSED TRANSFER LEAVES THE EXISTING ASSIGNMENT INTACT',
          v_after_active = v_before_active,
          format('active before %s, after %s', v_before_active, v_after_active));

  -- The manager holds candidate.assign, so the same call must succeed.
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_new_id := public.reassign_candidate(c_lucia, v_target);
  reset role;

  select count(*) filter (where ends_on is null), count(*)
    into v_after_active, v_after_total
    from public.candidate_assignments
   where candidate_id = c_lucia and assignment_type = 'primary_recruiter';

  insert into test.results (section, name, passed, detail)
  values ('assignments', 'A TRANSFER LEAVES EXACTLY ONE ACTIVE PRIMARY RECRUITER',
          v_after_active = 1, format('active after transfer: %s', v_after_active));

  insert into test.results (section, name, passed, detail)
  values ('assignments', 'A TRANSFER KEEPS THE PREVIOUS ASSIGNMENT AS HISTORY',
          v_after_total = v_before_total + 1,
          format('rows before %s, after %s', v_before_total, v_after_total));

  insert into test.results (section, name, passed, detail)
  values ('assignments', 'THE CLOSED ASSIGNMENT RECORDS WHO ENDED IT AND WHEN',
          coalesce((select ends_on is not null and ended_by is not null
                      from public.candidate_assignments where id = v_previous_id), false),
          'the row the transfer closed');

  insert into test.results (section, name, passed, detail)
  values ('assignments', 'the new assignment names the person it was transferred to',
          coalesce((select user_id = v_target
                      from public.candidate_assignments where id = v_new_id), false), 'ok');

  -- Transferring to the person who already holds it is a no-op the function
  -- refuses rather than performs, so it cannot churn the history.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.reassign_candidate(c_lucia, v_target);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  insert into test.results (section, name, passed, detail)
  values ('assignments', 'transferring to the current holder is refused',
          v_blocked, case when v_blocked then 'ok' else 'a duplicate assignment was created' end);
end $$;

-- ===========================================================================
-- BUILD 5.1 — Ownership and attribution
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SECTION 33 — Who owns the work is not who typed it
--
-- Every assertion below distinguishes two facts about the same row:
--   created_by / source_type  — provenance, who or what produced it
--   responsible_recruiter_id  — ownership, who was accountable at the time
--
-- Re-runnable: each fixture is deleted before it is inserted, because the
-- mutation harness runs this file twice and a block that aborts on the second
-- pass silently drops every assertion below it.
-- ---------------------------------------------------------------------------
do $$
declare
  c_priya     constant uuid := '00000000-0000-4000-a000-000000000001';
  c_dmitri    constant uuid := '00000000-0000-4000-a000-000000000004';
  c_lucia     constant uuid := '00000000-0000-4000-a000-000000000003';
  -- APAC. Salas can neither read nor write anything of Hiroshi's, which is
  -- what makes him the right subject for a cross-candidate grab. Lucia is
  -- not: section 32 transfers her, so who owns her depends on run order.
  c_hiroshi   constant uuid := '00000000-0000-4000-a000-000000000006';
  c_apac      constant uuid := '00000000-0000-4000-9000-000000000002';
  c_eu        constant uuid := '00000000-0000-4000-9000-000000000001';
  c_salas     constant uuid := '00000000-0000-4000-8000-000000000003';
  c_halvorsen constant uuid := '00000000-0000-4000-8000-000000000004';
  c_manager   constant uuid := '00000000-0000-4000-8000-000000000002';
  c_period    constant uuid := '00000000-0000-4000-8c00-000000000001';
  c_app_base  constant uuid := '00000000-0000-4000-8f00-000000000101';

  a_manual  constant uuid := '00000000-0000-4000-8f00-0000000005a1';
  a_system  constant uuid := '00000000-0000-4000-8f00-0000000005a2';
  a_email   constant uuid := '00000000-0000-4000-8f00-0000000005a3';
  a_dmitri  constant uuid := '00000000-0000-4000-8f00-0000000005a4';
  i_manual  constant uuid := '00000000-0000-4000-9200-0000000005b1';
  i_system  constant uuid := '00000000-0000-4000-9200-0000000005b2';
  i_email   constant uuid := '00000000-0000-4000-9200-0000000005b3';
  s_system  constant uuid := '00000000-0000-4000-9300-0000000005c1';
  m_system  constant uuid := '00000000-0000-4000-9100-0000000005d1';

  v_day       date := current_date - 3;
  v_owner     uuid;
  v_creator   uuid;
  v_source    source_kind;
  v_blocked   boolean;
  v_lucia_owner uuid;
  v_claimed     uuid;
  v_still       uuid;
  v_before    bigint;
  v_after     bigint;
begin
  delete from public.marketing_activities where id = m_system;
  delete from public.interviews  where id in (i_manual, i_system, i_email);
  delete from public.assessments where id = s_system;
  delete from public.marketing_activities
   where application_id in (a_manual, a_system, a_email, a_dmitri);
  delete from public.applications where id in (a_manual, a_system, a_email, a_dmitri);

  -- ---- 1. Manual: the owning recruiter records their own work ------------
  perform set_config('app.actor_id', c_salas::text, true);
  insert into public.applications
    (id, business_unit_id, candidate_id, marketing_period_id, company_name,
     position_title, job_id, application_date, source_type, created_by,
     responsible_recruiter_id)
  values (a_manual, c_eu, c_priya, c_period, 'Aldergate Clinical',
          'Data Manager', 'REF-5A1', v_day, 'manual', c_salas,
          -- Supplied on purpose: the trigger must ignore it.
          c_halvorsen);

  select responsible_recruiter_id, created_by, source_type
    into v_owner, v_creator, v_source
    from public.applications where id = a_manual;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'manual application is owned by the responsible recruiter',
     v_owner = c_salas, format('owner %s', v_owner)),
    ('attribution', 'A SUPPLIED RESPONSIBLE RECRUITER IS DISCARDED, NOT TRUSTED',
     v_owner <> c_halvorsen, format('owner %s', v_owner)),
    ('attribution', 'manual application keeps its creator',
     v_creator = c_salas, format('creator %s', v_creator)),
    ('attribution', 'manual application keeps its source',
     v_source = 'manual', format('source %s', v_source));

  -- ---- 2. CASE A: an automated pipeline, no session actor ---------------
  perform set_config('app.actor_id', '', true);
  insert into public.applications
    (id, business_unit_id, candidate_id, marketing_period_id, company_name,
     position_title, job_id, application_date, source_type, source_reference,
     created_by)
  values (a_system, c_eu, c_priya, c_period, 'Beacon Trials',
          'CDM Analyst', 'REF-5A2', v_day, 'system', 'pipeline:test:5a2', null);

  select responsible_recruiter_id, created_by, source_type
    into v_owner, v_creator, v_source
    from public.applications where id = a_system;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'CASE A — SYSTEM-CREATED APPLICATION IS OWNED BY THE RECRUITER',
     v_owner = c_salas, format('owner %s', v_owner)),
    ('attribution', 'CASE A — a system-created record has no human creator',
     v_creator is null, format('creator %s', v_creator)),
    ('attribution', 'CASE A — source_type records that the system produced it',
     v_source = 'system', format('source %s', v_source));

  -- ---- 3. CASE B: an email-derived application --------------------------
  insert into public.applications
    (id, business_unit_id, candidate_id, marketing_period_id, company_name,
     position_title, job_id, application_date, source_type, source_reference,
     created_by)
  values (a_email, c_eu, c_priya, c_period, 'Cranmere Bio',
          'Clinical Programmer', 'REF-5A3', v_day, 'email_event',
          'message-id:<test-5a3@example.invalid>', null);

  select responsible_recruiter_id, source_type into v_owner, v_source
    from public.applications where id = a_email;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'EMAIL-DERIVED APPLICATION IS OWNED BY THE RECRUITER',
     v_owner = c_salas, format('owner %s', v_owner)),
    ('attribution', 'an email-derived record keeps email provenance',
     v_source = 'email_event', format('source %s', v_source));

  -- ---- 4-6. Interviews: manual, system, email ---------------------------
  perform set_config('app.actor_id', c_manager::text, true);
  insert into public.interviews
    (id, business_unit_id, candidate_id, application_id, interview_round,
     scheduled_at, status, source_type, created_by)
  values (i_manual, c_eu, c_priya, c_app_base, 2,
          v_day::timestamptz + interval '9 hours', 'completed', 'manual', c_manager);

  perform set_config('app.actor_id', '', true);
  insert into public.interviews
    (id, business_unit_id, candidate_id, application_id, interview_round,
     scheduled_at, status, source_type, created_by)
  values (i_system, c_eu, c_priya, c_app_base, 3,
          v_day::timestamptz + interval '10 hours', 'completed', 'system', null);

  insert into public.interviews
    (id, business_unit_id, candidate_id, application_id, interview_round,
     scheduled_at, status, source_type, source_reference, created_by)
  values (i_email, c_eu, c_priya, c_app_base, 4,
          v_day::timestamptz + interval '11 hours', 'completed', 'email_event',
          'message-id:<test-5b3@example.invalid>', null);

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'CASE C — a manager-created interview is owned by the recruiter',
     (select responsible_recruiter_id from public.interviews where id = i_manual) = c_salas,
     'manager typed it, recruiter owns it'),
    ('attribution', 'CASE C — the manager remains the creator',
     (select created_by from public.interviews where id = i_manual) = c_manager, 'ok'),
    ('attribution', 'SYSTEM-CREATED INTERVIEW IS OWNED BY THE RECRUITER',
     (select responsible_recruiter_id from public.interviews where id = i_system) = c_salas, 'ok'),
    ('attribution', 'CASE B — EMAIL-CREATED INTERVIEW IS OWNED BY THE RECRUITER',
     (select responsible_recruiter_id from public.interviews where id = i_email) = c_salas, 'ok'),
    ('attribution', 'CASE B — the email interview keeps created_by null and source email',
     (select created_by is null and source_type = 'email_event'
        from public.interviews where id = i_email), 'ok');

  -- ---- 7. Assessments ---------------------------------------------------
  insert into public.assessments
    (id, business_unit_id, candidate_id, application_id, assessment_type,
     received_at, status, source_type, created_by)
  values (s_system, c_eu, c_priya, c_app_base, 'Automated coding exercise',
          v_day::timestamptz + interval '12 hours', 'completed', 'system', null);

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'SYSTEM-CREATED ASSESSMENT IS OWNED BY THE RECRUITER',
     (select responsible_recruiter_id from public.assessments where id = s_system) = c_salas, 'ok');

  -- ---- 8. Marketing activities -----------------------------------------
  insert into public.marketing_activities
    (id, business_unit_id, candidate_id, application_id, marketing_period_id,
     activity_type, activity_date, summary, source_type, created_by)
  values (m_system, c_eu, c_priya, c_app_base, c_period, 'recruiter_response',
          v_day::timestamptz + interval '13 hours', 'Automated reply detected',
          'email_event', null);

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'SYSTEM-CREATED ACTIVITY IS OWNED BY THE RECRUITER',
     (select responsible_recruiter_id from public.marketing_activities where id = m_system) = c_salas, 'ok'),
    ('attribution', 'an automatic activity stays identifiable as automatic',
     (select source_type <> 'manual' and created_by is null
        from public.marketing_activities where id = m_system), 'ok');

  -- ---- 9-13. The figures follow ownership ------------------------------
  insert into test.results (section, name, passed, detail) values
    ('attribution', 'DAILY REPORT APPLICATIONS COUNT WHAT THE RECRUITER OWNS',
     (select applications from public.daily_report_metrics(c_salas, v_day))
       = (select count(*) from public.applications
           where responsible_recruiter_id = c_salas and application_date = v_day), 'ok'),
    ('attribution', 'SYSTEM-CREATED RECORDS APPEAR IN THE RECRUITER''S REPORT',
     (select applications from public.daily_report_metrics(c_salas, v_day))
       >= (select count(*) from public.applications
            where responsible_recruiter_id = c_salas and application_date = v_day
              and created_by is null), 'ok'),
    ('attribution', 'DAILY REPORT INTERVIEWS COUNT WHAT THE RECRUITER OWNS',
     (select interviews from public.daily_report_metrics(c_salas, v_day))
       = (select count(*) from public.interviews
           where responsible_recruiter_id = c_salas
             and (scheduled_at at time zone 'UTC')::date = v_day), 'ok'),
    ('attribution', 'DAILY REPORT ASSESSMENTS COUNT WHAT THE RECRUITER OWNS',
     (select assessments from public.daily_report_metrics(c_salas, v_day))
       = (select count(*) from public.assessments
           where responsible_recruiter_id = c_salas
             and (received_at at time zone 'UTC')::date = v_day), 'ok'),
    ('attribution', 'DAILY REPORT REJECTIONS COUNT WHAT THE RECRUITER OWNS',
     (select rejections from public.daily_report_metrics(c_salas, current_date - 2))
       = (select count(*) from public.marketing_activities
           where responsible_recruiter_id = c_salas and activity_type = 'rejection'
             and (activity_date at time zone 'UTC')::date = current_date - 2), 'ok'),
    ('attribution', 'a report counts nothing the recruiter merely typed for somebody else',
     (select applications from public.daily_report_metrics(c_manager, v_day))
       = (select count(*) from public.applications
           where responsible_recruiter_id = c_manager and application_date = v_day), 'ok');

  -- ---- 14-15. Reassignment ---------------------------------------------
  -- Dmitri moved from Halvorsen to Salas two days ago. Records predating the
  -- handover must stay with Halvorsen; new ones belong to Salas.
  insert into test.results (section, name, passed, detail) values
    ('attribution', 'HISTORICAL RECORDS KEEP THE RECRUITER WHO OWNED THEM AT THE TIME',
     (select count(*) from public.applications
       where candidate_id = c_dmitri and application_date < current_date - 2
         and responsible_recruiter_id is distinct from c_halvorsen) = 0,
     'pre-handover records still belong to Halvorsen'),
    ('attribution', 'reassignment did not rewrite any historical attribution',
     (select count(*) > 0 from public.applications
       where candidate_id = c_dmitri and responsible_recruiter_id = c_halvorsen),
     'at least one historical record survives the handover');

  perform set_config('app.actor_id', c_salas::text, true);
  insert into public.applications
    (id, business_unit_id, candidate_id, company_name, position_title, job_id,
     application_date, source_type, created_by)
  values (a_dmitri, c_eu, c_dmitri, 'Post-handover Clinical', 'Data Manager',
          'REF-5A4', current_date, 'manual', c_salas);

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'A RECORD CREATED AFTER A HANDOVER BELONGS TO THE NEW RECRUITER',
     (select responsible_recruiter_id from public.applications where id = a_dmitri) = c_salas,
     'ok');

  -- ---- 18. Ownership cannot be edited by a recruiter --------------------
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_salas, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.applications
       set responsible_recruiter_id = c_salas
     where id = (select id from public.applications
                 where candidate_id = c_dmitri and responsible_recruiter_id = c_halvorsen
                 limit 1);
    if not found then v_blocked := true; end if;
  exception when others then
    v_blocked := true;
  end;
  reset role;

  select responsible_recruiter_id into v_still
    from public.applications
   where candidate_id = c_dmitri and application_date < current_date - 2
   limit 1;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'A RECRUITER CANNOT REATTRIBUTE A HISTORICAL RECORD TO THEMSELVES',
     v_blocked, case when v_blocked then 'ok' else 'the update was accepted' end),
    ('attribution', 'the historical record still names the recruiter who owned it',
     v_still = c_halvorsen, format('owner is still %s', v_still));

  -- ---- 19. A recruiter cannot claim another unit's candidate ------------
  -- Salas cannot read or write anything of Hiroshi's, so the row is refused
  -- before ownership is even reached.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_salas, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.applications
      (business_unit_id, candidate_id, company_name, position_title,
       application_date, source_type, created_by, responsible_recruiter_id)
    values (c_apac, c_hiroshi, 'Attempted Grab Ltd', 'Data Manager',
            current_date, 'manual', c_salas, c_salas);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'CROSS-CANDIDATE OWNERSHIP GRAB IS REFUSED',
     v_blocked, case when v_blocked then 'ok' else 'the insert was accepted' end);

  -- ---- 20. Naming somebody else as owner in the payload -----------------
  -- Whoever currently holds Lucia, the payload claims the OTHER recruiter.
  -- Resolved dynamically because section 32 transfers her, so hardcoding a
  -- name here would assert run order rather than behaviour.
  v_lucia_owner := util.responsible_recruiter(c_lucia, current_date);
  v_claimed := case when v_lucia_owner = c_salas then c_halvorsen else c_salas end;

  delete from public.applications where id = a_manual;
  perform set_config('app.actor_id', v_lucia_owner::text, true);
  insert into public.applications
    (id, business_unit_id, candidate_id, company_name, position_title, job_id,
     application_date, source_type, created_by, responsible_recruiter_id)
  values (a_manual, c_eu, c_lucia, 'Ownership Claim Ltd', 'Data Manager',
          'REF-5A1', current_date, 'manual', v_lucia_owner, v_claimed);

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'A CREATOR CANNOT NAME A DIFFERENT RECRUITER AS OWNER',
     (select responsible_recruiter_id from public.applications where id = a_manual)
       = v_lucia_owner,
     format('payload claimed %s, assignment says %s', v_claimed, v_lucia_owner));

  -- ---- Reports are not the source of truth ------------------------------
  select count(*) into v_before from public.applications;
  perform public.daily_report_metrics(c_salas, v_day);
  select count(*) into v_after from public.applications;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'reading the metrics alters no source record',
     v_before = v_after, format('%s then %s', v_before, v_after));

  perform set_config('app.actor_id', '', true);
end $$;

-- The column lives on candidate-visible rows, so a candidate can read the uuid.
-- What they cannot do is turn it into a person: `users` refuses them every row
-- but their own. Asserted rather than assumed.
select test.check('attribution', 'A CANDIDATE CANNOT RESOLVE A RESPONSIBLE RECRUITER TO A PERSON',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.users where id in '
    || '(select responsible_recruiter_id from public.applications)'), 0::bigint);

select test.check('attribution', 'candidates are never named as a responsible recruiter',
  (select count(*) from public.applications a
    join public.user_roles ur on ur.user_id = a.responsible_recruiter_id
   where ur.role_code = 'candidate'), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 34 — A recruiter's own figures are complete, and nobody else's leak
--
-- The figures must not depend on who currently holds the candidate: work done
-- before a handover is still work that was done. And the completeness must not
-- be bought by letting anyone read anyone's numbers.
-- ---------------------------------------------------------------------------
do $$
declare
  c_salas     constant uuid := '00000000-0000-4000-8000-000000000003';
  c_halvorsen constant uuid := '00000000-0000-4000-8000-000000000004';
  c_manager   constant uuid := '00000000-0000-4000-8000-000000000002';
  c_rossi     constant uuid := '00000000-0000-4000-8000-000000000005';
  c_priya_u   constant uuid := '00000000-0000-4000-8000-000000000011';
  c_dmitri    constant uuid := '00000000-0000-4000-a000-000000000004';

  v_day        date;
  v_truth      bigint;
  v_as_self    bigint;
  v_as_manager bigint;
  v_blocked    boolean;
begin
  -- A day on which Halvorsen owned a Dmitri record, before Salas took over.
  select a.application_date into v_day
    from public.applications a
   where a.candidate_id = c_dmitri
     and a.responsible_recruiter_id = c_halvorsen
   order by a.application_date
   limit 1;

  if v_day is null then
    insert into test.results (section, name, passed, detail)
    values ('attribution', 'HANDOVER FIXTURE EXISTS', false,
            'no pre-handover record for Dmitri — the completeness check is vacuous');
    return;
  end if;

  select count(*) into v_truth
    from public.applications
   where responsible_recruiter_id = c_halvorsen and application_date = v_day;

  -- As himself, having since lost the candidate to Salas.
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_halvorsen, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select applications into v_as_self from public.daily_report_metrics(c_halvorsen, v_day);
  reset role;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'A HANDOVER DOES NOT ERASE THE FIGURES OF THE PREVIOUS RECRUITER',
     v_as_self = v_truth, format('expected %s, got %s', v_truth, v_as_self));

  -- The manager may read them too, because the report itself is unit-visible.
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select applications into v_as_manager from public.daily_report_metrics(c_halvorsen, v_day);
  reset role;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'a manager reads the same figures the recruiter sees',
     v_as_manager = v_truth, format('expected %s, got %s', v_truth, v_as_manager));

  -- A recruiter reading a colleague's figures is refused outright rather than
  -- being handed a quietly filtered number.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_salas, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.daily_report_metrics(c_halvorsen, v_day);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'A RECRUITER CANNOT READ THE FIGURES OF A COLLEAGUE',
     v_blocked, case when v_blocked then 'ok' else 'the figures were returned' end);

  -- Cross-unit, even for someone who can read every report in their own unit.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.daily_report_metrics(c_rossi, v_day);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'CROSS-UNIT: A MANAGER CANNOT READ ANOTHER UNIT''S FIGURES',
     v_blocked, case when v_blocked then 'ok' else 'the figures were returned' end);

  -- And a candidate cannot read anybody's, including their own recruiter's.
  v_blocked := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_priya_u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.daily_report_metrics(c_salas, v_day);
  exception when others then
    v_blocked := true;
  end;
  reset role;

  insert into test.results (section, name, passed, detail) values
    ('attribution', 'A CANDIDATE CANNOT READ RECRUITER FIGURES',
     v_blocked, case when v_blocked then 'ok' else 'the figures were returned' end);
end $$;

-- ===========================================================================
-- BUILD 6 — Email evidence
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SECTION 35 — Candidates have no access of any kind  ***critical***
--
-- Email is the most sensitive data in the product: one mailbox holds every
-- candidate's correspondence mixed together, with no per-candidate boundary,
-- because nothing has been matched to a candidate yet. A portal account must
-- therefore see none of it — not their own, not a filtered subset, none.
-- ---------------------------------------------------------------------------
select test.check('email', 'CANDIDATE CANNOT READ ANY EMAIL MESSAGE',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.email_messages'), 0::bigint);

select test.check('email', 'A SECOND CANDIDATE ALSO READS NO EMAIL',
  test.count_as(:'LUCIA_USER', 'select count(*) from public.email_messages'), 0::bigint);

select test.check('email', 'CANDIDATE CANNOT READ EMAIL THREADS',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.email_threads'), 0::bigint);

select test.check('email', 'CANDIDATE CANNOT READ ATTACHMENT METADATA',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.email_attachments'), 0::bigint);

select test.check('email', 'CANDIDATE CANNOT READ MAILBOX CONFIGURATION',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.mailboxes'), 0::bigint);

select test.check('email', 'candidate cannot read sync history',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.mailbox_sync_runs'), 0::bigint);

-- Naming a row directly, rather than counting, in case a policy ever filters
-- by something a candidate could satisfy.
select test.check('email', 'CANDIDATE CANNOT READ A NAMED EMAIL BODY',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.email_messages where body_text is not null'), 0::bigint);

select test.check('email', 'CANDIDATE CANNOT READ A PROVIDER MESSAGE ID',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.email_messages where provider_message_id is not null'),
  0::bigint);

select test.check('email', 'anonymous callers reach no email table',
  test.count_anon('select count(*) from public.email_messages'), -1::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 36 — Internal authorization
--
-- Recruiters hold no email capability by default. That is a decision, not an
-- omission: there is no per-candidate filter to apply to a mailbox nobody has
-- matched yet, so the honest default is none.
-- ---------------------------------------------------------------------------
select test.check('email', 'AN UNAUTHORIZED RECRUITER READS NO EMAIL',
  test.count_as(:'SALAS', 'select count(*) from public.email_messages'), 0::bigint);

select test.check('email', 'an unauthorized recruiter sees no mailbox',
  test.count_as(:'SALAS', 'select count(*) from public.mailboxes'), 0::bigint);

select test.check('email', 'AUTHORIZED MANAGER READS THEIR UNIT''S EMAIL',
  test.count_as(:'MANAGER', 'select count(*) from public.email_messages'),
  (select count(*) from public.email_messages where business_unit_id = :'EU_UNIT'::uuid));

select test.check('email', 'authorized manager sees their unit''s mailboxes',
  test.count_as(:'MANAGER', 'select count(*) from public.mailboxes'),
  (select count(*) from public.mailboxes where business_unit_id = :'EU_UNIT'::uuid));

select test.check('email', 'admin reads every mailbox across units',
  test.count_as(:'ADMIN', 'select count(*) from public.mailboxes'),
  (select count(*) from public.mailboxes));

-- A manager may look at the mailbox, but connecting one is an administrator's
-- act: mailbox.manage is admin-only.
select test.check('email', 'A MANAGER CANNOT CONNECT A MAILBOX',
  test.write_denied(:'MANAGER',
    'insert into public.mailboxes (business_unit_id, provider, mailbox_address) values ('
    || quote_literal(:'EU_UNIT') || ', ''gmail'', ''sneaky@medinext.invalid'')'),
  true);

select test.check('email', 'a recruiter cannot connect a mailbox either',
  test.write_denied(:'SALAS',
    'insert into public.mailboxes (business_unit_id, provider, mailbox_address) values ('
    || quote_literal(:'EU_UNIT') || ', ''gmail'', ''sneakier@medinext.invalid'')'),
  true);

-- Evidence is read-only through the API. Every write happens under the service
-- role in the ingestion service, so there is no grant to widen.
select test.check('email', 'NOBODY CAN INSERT AN EMAIL THROUGH THE API',
  test.write_denied(:'ADMIN',
    'insert into public.email_messages (business_unit_id, mailbox_id, thread_id, '
    || 'provider_message_id, from_address, received_at) values ('
    || quote_literal(:'EU_UNIT') || ', ''00000000-0000-4000-9600-000000000001'', '
    || '''00000000-0000-4000-9700-000000000001'', ''forged-1'', ''a@b.invalid'', now())'),
  true);

select test.check('email', 'NOBODY CAN EDIT AN EMAIL THROUGH THE API',
  test.write_denied(:'ADMIN',
    'update public.email_messages set body_text = ''rewritten'' where id = '
    || quote_literal('00000000-0000-4000-9800-000000000001')),
  true);

select test.check('email', 'nobody can delete an email through the API',
  test.write_denied(:'ADMIN',
    'delete from public.email_messages where id = '
    || quote_literal('00000000-0000-4000-9800-000000000001')),
  true);

-- ---------------------------------------------------------------------------
-- SECTION 37 — Tenancy
-- ---------------------------------------------------------------------------
select test.check('email', 'CROSS-TENANT: EU MANAGER CANNOT READ THE APAC MESSAGE',
  test.count_as(:'MANAGER',
    'select count(*) from public.email_messages where id = '
    || quote_literal('00000000-0000-4000-9800-000000000006')), 0::bigint);

select test.check('email', 'CROSS-TENANT: EU MANAGER CANNOT READ THE APAC MAILBOX',
  test.count_as(:'MANAGER',
    'select count(*) from public.mailboxes where id = '
    || quote_literal('00000000-0000-4000-9600-000000000002')), 0::bigint);

select test.check('email', 'cross-tenant: EU manager cannot read the APAC thread',
  test.count_as(:'MANAGER',
    'select count(*) from public.email_threads where id = '
    || quote_literal('00000000-0000-4000-9700-000000000003')), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 38 — Credentials
--
-- The tokens table is not merely policy-protected: it lives outside `public`,
-- so PostgREST cannot address it and `authenticated` holds no grant on it.
-- ---------------------------------------------------------------------------
select test.check('email', 'THE CREDENTIALS TABLE IS NOT IN A POSTGREST-EXPOSED SCHEMA',
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'mailbox_credentials'), 0::bigint);

select test.check('email', 'AUTHENTICATED HOLDS NO GRANT ON THE CREDENTIALS TABLE',
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'private' and table_name = 'mailbox_credentials'
      and grantee in ('authenticated', 'anon', 'PUBLIC')), 0::bigint);

select test.check('email', 'ADMIN CANNOT READ STORED TOKENS',
  test.count_as(:'ADMIN', 'select count(*) from private.mailbox_credentials'), -1::bigint);

select test.check('email', 'no email table stores a token or a secret',
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name in ('mailboxes', 'email_messages', 'email_threads',
                         'email_attachments', 'mailbox_sync_runs')
      and (column_name like '%token%' or column_name like '%secret%'
           or column_name like '%password%')), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 39 — Idempotency, threading and state
-- ---------------------------------------------------------------------------
select test.check('email', 'THE REDELIVERED MESSAGE WAS NOT DUPLICATED',
  (select count(*) from public.email_messages
    where mailbox_id = '00000000-0000-4000-9600-000000000001'
      and provider_message_id = 'msg-northwind-003'), 1::bigint);

select test.check('email', 'the redelivery moved last_seen_at past first_seen_at',
  (select last_seen_at > first_seen_at from public.email_messages
    where provider_message_id = 'msg-northwind-003'), true);

select test.check('email', 'thread membership matches the messages themselves',
  (select count(*) from public.email_threads t
    where t.message_count <> (select count(*) from public.email_messages m
                               where m.thread_id = t.id)), 0::bigint);

select test.check('email', 'a thread cannot hold a message from another mailbox',
  (select count(*) from public.email_messages m
     join public.email_threads t on t.id = m.thread_id
    where t.mailbox_id <> m.mailbox_id), 0::bigint);

-- Threading is by provider id, so two different threads may legitimately share
-- a normalized subject. This asserts the identity key is the provider's.
select test.check('email', 'THREAD IDENTITY IS THE PROVIDER ID, NOT THE SUBJECT',
  (select count(*) from pg_indexes
    where tablename = 'email_threads'
      and indexdef like '%provider_thread_id%' and indexdef like 'CREATE UNIQUE%'), 1::bigint);

do $$
declare
  v_msg     constant uuid := '00000000-0000-4000-9800-000000000001';
  v_blocked boolean := false;
begin
  -- ready -> received is not a legal transition; only a failure may be retried.
  begin
    update public.email_messages set processing_status = 'received' where id = v_msg;
  exception when others then
    v_blocked := true;
  end;

  insert into test.results (section, name, passed, detail)
  values ('email', 'AN ILLEGAL PROCESSING TRANSITION IS REFUSED',
          v_blocked, case when v_blocked then 'ok' else 'ready -> received was accepted' end);

  -- ready -> processing -> ready is legal, and clears any stale error.
  update public.email_messages set processing_status = 'processing' where id = v_msg;
  update public.email_messages set processing_status = 'ready' where id = v_msg;

  insert into test.results (section, name, passed, detail)
  values ('email', 'a legal processing transition is allowed',
          (select processing_status = 'ready' from public.email_messages where id = v_msg), 'ok');

  -- A failed message must carry a reason; the check constraint enforces it.
  v_blocked := false;
  begin
    update public.email_messages
       set processing_status = 'failed', processing_error = null
     where id = v_msg;
  exception when others then
    v_blocked := true;
  end;

  insert into test.results (section, name, passed, detail)
  values ('email', 'A FAILED MESSAGE MUST SAY WHY',
          v_blocked, case when v_blocked then 'ok' else 'a failure with no reason was accepted' end);
end $$;

-- ---------------------------------------------------------------------------
-- SECTION 40 — Sync state and audit
-- ---------------------------------------------------------------------------
select test.check('email', 'A FAILED SYNC RECORDED NO NEW CURSOR',
  (select count(*) from public.mailbox_sync_runs
    where status = 'failed' and cursor_after is not null), 0::bigint);

select test.check('email', 'THE FAILURE DID NOT LOSE THE LAST GOOD CURSOR',
  (select sync_cursor is not null from public.mailboxes
    where id = '00000000-0000-4000-9600-000000000001'), true);

select test.check('email', 'a failed sync explains itself',
  (select count(*) from public.mailbox_sync_runs
    where status = 'failed' and error_message is null), 0::bigint);

select test.check('email', 'the last successful sync is recorded separately from the last attempt',
  (select last_successful_sync_at is not null and last_sync_attempted_at is not null
     from public.mailboxes where id = '00000000-0000-4000-9600-000000000001'), true);

select test.check('email', 'mailbox connection is captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'mailboxes' and action = 'insert'), true);

select test.check('email', 'message ingestion is captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'email_messages' and action = 'insert'), true);

select test.check('email', 'sync runs are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'mailbox_sync_runs'), true);

select test.check('email', 'processing state changes are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'email_messages' and action = 'update'
      and 'processing_status' = any(changed_fields)), true);

-- The audit log must not become a second copy of the mailbox.
select test.check('email', 'NO EMAIL BODY REACHES THE AUDIT LOG',
  (select count(*) from audit.audit_logs
    where entity_type = 'email_messages'
      and (new_data ->> 'body_text') is not null
      and (new_data ->> 'body_text') <> '[redacted]'), 0::bigint);

select test.check('email', 'no subject or sender reaches the audit log',
  (select count(*) from audit.audit_logs
    where entity_type = 'email_messages'
      and coalesce(new_data ->> 'subject', '[redacted]') <> '[redacted]'), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 41 — The architectural boundary  ***the point of the build***
--
-- No email row may reference a CRM record, in either direction. Build 7 will
-- connect them through a validated, reviewable step; until then the absence is
-- what guarantees an email cannot silently become a business record.
-- ---------------------------------------------------------------------------
select test.check('email', 'NO EMAIL TABLE REFERENCES A CRM RECORD',
  (select count(*) from information_schema.table_constraints tc
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name in ('email_messages', 'email_threads', 'email_attachments',
                            'mailboxes', 'mailbox_sync_runs')
      and ccu.table_name in ('candidates', 'applications', 'interviews', 'assessments',
                             'marketing_activities', 'candidate_assignments',
                             'notifications', 'review_items')), 0::bigint);

select test.check('email', 'NO CRM TABLE REFERENCES AN EMAIL RECORD',
  (select count(*) from information_schema.table_constraints tc
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name in ('candidates', 'applications', 'interviews', 'assessments',
                            'marketing_activities', 'notifications', 'review_items')
      and ccu.table_name in ('email_messages', 'email_threads', 'email_attachments',
                             'mailboxes')), 0::bigint);

select test.check('email', 'no email table carries a candidate column',
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name in ('email_messages', 'email_threads', 'email_attachments',
                         'mailboxes', 'mailbox_sync_runs')
      and column_name in ('candidate_id', 'application_id', 'interview_id', 'assessment_id')),
  0::bigint);

-- No business record traces back to an ingested message.
--
-- Counting `source_type = 'email_event'` would be the obvious assertion and
-- would be wrong: Build 5.1's attribution tests deliberately create records
-- with that source to simulate the future pipeline, and they are not evidence
-- of anything Build 6 did. What actually has to be true is narrower and
-- stronger — no CRM row cites a message this build ingested.
select test.check('email', 'NO APPLICATION CITES AN INGESTED MESSAGE',
  (select count(*) from public.applications a
    where exists (
      select 1 from public.email_messages m
      where a.source_reference is not null
        and (a.source_reference = m.provider_message_id
             or a.source_reference = m.internet_message_id
             or a.source_reference like '%' || m.provider_message_id || '%')
    )), 0::bigint);

select test.check('email', 'NO INTERVIEW CITES AN INGESTED MESSAGE',
  (select count(*) from public.interviews i
    where exists (
      select 1 from public.email_messages m
      where i.source_reference is not null
        and (i.source_reference = m.provider_message_id
             or i.source_reference = m.internet_message_id
             or i.source_reference like '%' || m.provider_message_id || '%')
    )), 0::bigint);

select test.check('email', 'no assessment cites an ingested message',
  (select count(*) from public.assessments s
    where exists (
      select 1 from public.email_messages m
      where s.source_reference is not null
        and (s.source_reference = m.provider_message_id
             or s.source_reference = m.internet_message_id
             or s.source_reference like '%' || m.provider_message_id || '%')
    )), 0::bigint);

-- And no marketing activity, which is the table an interpretation layer would
-- reach for first.
select test.check('email', 'no marketing activity cites an ingested message',
  (select count(*) from public.marketing_activities a
    where exists (
      select 1 from public.email_messages m
      where a.source_reference is not null
        and a.source_reference like '%' || m.provider_message_id || '%'
    )), 0::bigint);

select test.check('email', 'ingesting email created no notification',
  (select count(*) from public.notifications
    where entity_type in ('email_message', 'mailbox')), 0::bigint);

-- ===========================================================================
-- BUILD 7A — Email intelligence
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SECTION 42 — Candidates see nothing, and cannot run anything ***critical***
-- ---------------------------------------------------------------------------
select test.check('intelligence', 'CANDIDATE CANNOT READ ANY INTERPRETATION',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.email_intelligence_runs'), 0::bigint);

select test.check('intelligence', 'A SECOND CANDIDATE ALSO READS NO INTERPRETATION',
  test.count_as(:'LUCIA_USER', 'select count(*) from public.email_intelligence_runs'), 0::bigint);

-- The proposal names a candidate; that candidate still must not see it.
select test.check('intelligence', 'A PROPOSED CANDIDATE CANNOT READ THEIR OWN PROPOSAL',
  test.count_as(:'PRIYA_USER',
    'select count(*) from public.email_intelligence_runs where proposed_candidate_id = '
    || quote_literal(:'PRIYA')), 0::bigint);

select test.check('intelligence', 'CANDIDATE CANNOT TRIGGER INTERPRETATION',
  test.write_denied(:'PRIYA_USER',
    'insert into public.email_intelligence_runs (business_unit_id, email_message_id, '
    || 'provider, model, prompt_version) values ('
    || quote_literal(:'EU_UNIT') || ', ''00000000-0000-4000-9800-000000000001'', '
    || '''openai'', ''gpt-4o-mini'', ''email_intelligence_v1'')'), true);

select test.check('intelligence', 'CANDIDATE CANNOT CHANGE A CONFIDENCE SCORE',
  test.write_denied(:'PRIYA_USER',
    'update public.email_intelligence_runs set event_confidence = 1 where id = '
    || quote_literal('00000000-0000-4000-9b00-000000000003')), true);

select test.check('intelligence', 'anonymous callers reach no interpretation',
  test.count_anon('select count(*) from public.email_intelligence_runs'), -1::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 43 — Internal authorization
-- ---------------------------------------------------------------------------
select test.check('intelligence', 'AN UNAUTHORIZED RECRUITER READS NO INTERPRETATION',
  test.count_as(:'SALAS', 'select count(*) from public.email_intelligence_runs'), 0::bigint);

select test.check('intelligence', 'AUTHORIZED MANAGER READS THEIR UNIT''S INTERPRETATIONS',
  test.count_as(:'MANAGER', 'select count(*) from public.email_intelligence_runs'),
  (select count(*) from public.email_intelligence_runs
    where business_unit_id = :'EU_UNIT'::uuid));

select test.check('intelligence', 'admin reads interpretations across units',
  test.count_as(:'ADMIN', 'select count(*) from public.email_intelligence_runs'),
  (select count(*) from public.email_intelligence_runs));

-- Results are written by the interpretation service under the service role.
-- Nothing reachable from a request may forge or edit one.
select test.check('intelligence', 'NOBODY CAN FORGE AN INTERPRETATION THROUGH THE API',
  test.write_denied(:'ADMIN',
    'insert into public.email_intelligence_runs (business_unit_id, email_message_id, '
    || 'provider, model, prompt_version, status, event_type, event_confidence, completed_at) '
    || 'values (' || quote_literal(:'EU_UNIT')
    || ', ''00000000-0000-4000-9800-000000000001'', ''openai'', ''forged'', ''v1'', '
    || '''completed'', ''interview'', 1, now())'), true);

-- Deliberately NOT a status change: the state-machine trigger would refuse
-- that on its own, so such an assertion could not tell a missing write policy
-- from a terminal state. Editing the summary and the confidence is refused
-- only because there is no way to write this table through the API at all.
select test.check('intelligence', 'NOBODY CAN EDIT AN INTERPRETATION THROUGH THE API',
  test.write_denied(:'ADMIN',
    'update public.email_intelligence_runs set summary = ''rewritten'', '
    || 'event_confidence = 1 where id = '
    || quote_literal('00000000-0000-4000-9b00-000000000003')), true);

select test.check('intelligence', 'nobody can delete an interpretation through the API',
  test.write_denied(:'ADMIN',
    'delete from public.email_intelligence_runs where id = '
    || quote_literal('00000000-0000-4000-9b00-000000000001')), true);

-- ---------------------------------------------------------------------------
-- SECTION 44 — Tenancy
-- ---------------------------------------------------------------------------
select test.check('intelligence', 'CROSS-TENANT: EU MANAGER CANNOT READ THE APAC INTERPRETATION',
  test.count_as(:'MANAGER',
    'select count(*) from public.email_intelligence_runs where id = '
    || quote_literal('00000000-0000-4000-9b00-000000000006')), 0::bigint);

-- A proposal naming a candidate from another unit is not merely refused by
-- policy — the composite foreign key makes the row unstorable.
do $$
declare v_blocked boolean := false;
begin
  begin
    insert into public.email_intelligence_runs
      (business_unit_id, email_message_id, provider, model, prompt_version,
       status, event_type, event_confidence, completed_at,
       proposed_candidate_id, candidate_match_confidence)
    values
      ('00000000-0000-4000-9000-000000000001',
       '00000000-0000-4000-9800-000000000001', 'fixture', 'x', 'v1',
       'completed', 'interview', 0.99, now(),
       -- Hiroshi belongs to APAC.
       '00000000-0000-4000-a000-000000000006', 0.99);
  exception when others then
    v_blocked := true;
  end;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'A CROSS-TENANT CANDIDATE PROPOSAL CANNOT BE STORED',
          v_blocked, case when v_blocked then 'ok' else 'the proposal was accepted' end);
end $$;

-- ---------------------------------------------------------------------------
-- SECTION 45 — Versioning, retries and state
-- ---------------------------------------------------------------------------
select test.check('intelligence', 'REPROCESSING ADDS A READING RATHER THAN REPLACING ONE',
  (select count(*) from public.email_intelligence_runs
    where email_message_id = '00000000-0000-4000-9800-000000000003'), 2::bigint);

select test.check('intelligence', 'the earlier reading kept its own conclusion',
  (select event_confidence from public.email_intelligence_runs
    where id = '00000000-0000-4000-9b00-000000000001'), 0.940::numeric);

select test.check('intelligence', 'every reading records provider, model and prompt version',
  (select count(*) from public.email_intelligence_runs
    where provider is null or model is null or prompt_version is null), 0::bigint);

select test.check('intelligence', 'a failed reading explains itself',
  (select count(*) from public.email_intelligence_runs
    where status = 'failed' and error_message is null), 0::bigint);

select test.check('intelligence', 'a stored proposal always carries a confidence',
  (select count(*) from public.email_intelligence_runs
    where proposed_candidate_id is not null and candidate_match_confidence is null), 0::bigint);

do $$
declare
  v_email   constant uuid := '00000000-0000-4000-9800-000000000001';
  v_run     uuid;
  v_second  uuid;
  v_blocked boolean := false;
  v_number  integer;
begin
  delete from public.email_intelligence_runs where email_message_id = v_email;

  insert into public.email_intelligence_runs
    (business_unit_id, email_message_id, provider, model, prompt_version, status)
  values ('00000000-0000-4000-9000-000000000001', v_email, 'fixture', 'x', 'v1', 'pending')
  returning id, run_number into v_run, v_number;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'the database allocates the reading number',
          v_number = 1, format('got %s', v_number));

  -- Two runs in flight for one email would spend two provider calls and race
  -- each other to a conclusion.
  begin
    insert into public.email_intelligence_runs
      (business_unit_id, email_message_id, provider, model, prompt_version, status)
    values ('00000000-0000-4000-9000-000000000001', v_email, 'fixture', 'x', 'v1', 'pending');
  exception when others then
    v_blocked := true;
  end;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'A SECOND READING CANNOT START WHILE ONE IS IN FLIGHT',
          v_blocked, case when v_blocked then 'ok' else 'a concurrent run was accepted' end);

  -- The service's real path: pending -> processing -> completed. Jumping
  -- straight to completed is itself refused, which is asserted below.
  update public.email_intelligence_runs
     set status = 'processing', started_at = now()
   where id = v_run;

  update public.email_intelligence_runs
     set status = 'completed', event_type = 'other', event_confidence = 1, completed_at = now()
   where id = v_run;

  v_blocked := false;
  begin
    update public.email_intelligence_runs set status = 'processing' where id = v_run;
  exception when others then
    v_blocked := true;
  end;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'A TERMINAL READING CANNOT BE REOPENED',
          v_blocked, case when v_blocked then 'ok' else 'completed -> processing was accepted' end);


  -- Once the first run is terminal, a retry is allowed and becomes reading 2.
  insert into public.email_intelligence_runs
    (business_unit_id, email_message_id, provider, model, prompt_version, status)
  values ('00000000-0000-4000-9000-000000000001', v_email, 'fixture', 'x', 'v1', 'pending')
  returning id, run_number into v_second, v_number;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'A RETRY AFTER A TERMINAL RUN BECOMES THE NEXT READING',
          v_number = 2, format('got %s', v_number));

  -- Skipping `processing` is refused too: a run that reached a conclusion
  -- without ever being in flight did not call a provider.
  v_blocked := false;
  begin
    update public.email_intelligence_runs
       set status = 'completed', completed_at = now()
     where id = v_second;
  exception when others then
    v_blocked := true;
  end;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'A READING CANNOT JUMP STRAIGHT TO A CONCLUSION',
          v_blocked, case when v_blocked then 'ok' else 'pending -> completed was accepted' end);


  -- A completed reading with no conclusion is not a reading.
  update public.email_intelligence_runs
     set status = 'processing', started_at = now()
   where id = v_second;

  v_blocked := false;
  begin
    update public.email_intelligence_runs
       set status = 'completed', completed_at = now(), event_type = null
     where id = v_second;
  exception when others then
    v_blocked := true;
  end;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'a completed reading must carry a classification',
          v_blocked, case when v_blocked then 'ok' else 'an empty conclusion was accepted' end);
end $$;

-- ---------------------------------------------------------------------------
-- SECTION 46 — Audit, and what must not reach it
-- ---------------------------------------------------------------------------
select test.check('intelligence', 'interpretation runs are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'email_intelligence_runs' and action = 'insert'), true);

select test.check('intelligence', 'state changes are captured in the audit log',
  (select count(*) > 0 from audit.audit_logs
    where entity_type = 'email_intelligence_runs' and action = 'update'
      and 'status' = any(changed_fields)), true);

select test.check('intelligence', 'NO INTERPRETED CONTENT REACHES THE AUDIT LOG',
  (select count(*) from audit.audit_logs
    where entity_type = 'email_intelligence_runs'
      and coalesce(new_data ->> 'summary', '[redacted]') <> '[redacted]'), 0::bigint);

select test.check('intelligence', 'no extracted data reaches the audit log',
  (select count(*) from audit.audit_logs
    where entity_type = 'email_intelligence_runs'
      and coalesce(new_data ->> 'extracted_data', '[redacted]') <> '[redacted]'), 0::bigint);

select test.check('intelligence', 'no quoted evidence reaches the audit log',
  (select count(*) from audit.audit_logs
    where entity_type = 'email_intelligence_runs'
      and coalesce(new_data ->> 'evidence', '[redacted]') <> '[redacted]'), 0::bigint);

-- ---------------------------------------------------------------------------
-- SECTION 47 — THE BUILD BOUNDARY  ***the point of Build 7A***
--
-- Interpretation may propose. It may not act.
-- ---------------------------------------------------------------------------
select test.check('intelligence', 'NO CRM TABLE REFERENCES AN INTERPRETATION',
  (select count(*) from information_schema.table_constraints tc
     join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name in ('candidates', 'applications', 'interviews', 'assessments',
                            'marketing_activities', 'notifications', 'review_items',
                            'candidate_assignments')
      and ccu.table_name = 'email_intelligence_runs'), 0::bigint);

select test.check('intelligence', 'NO TRIGGER ON INTERPRETATION WRITES TO A CRM TABLE',
  (select count(*) from pg_trigger tg
     join pg_class c on c.oid = tg.tgrelid
     join pg_proc p on p.oid = tg.tgfoid
    where c.relname = 'email_intelligence_runs'
      and not tg.tgisinternal
      and p.prosrc ~* 'insert into public\.(candidates|applications|interviews|assessments|marketing_activities|notifications)'),
  0::bigint);

-- No function anywhere turns a reading into a record. Build 7B adds one, with
-- a decision step in front of it.
select test.check('intelligence', 'NO FUNCTION PROMOTES AN INTERPRETATION INTO A RECORD',
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'util')
      and p.prosrc ~* 'email_intelligence_runs'
      and p.prosrc ~* 'insert into public\.(candidates|applications|interviews|assessments|marketing_activities|notifications)'),
  0::bigint);

-- The seeded readings classify interviews, assessments and rejections. None of
-- them produced one.
select test.check('intelligence', 'AN INTERVIEW READING CREATED NO INTERVIEW',
  (select count(*) from public.interviews i
    where exists (
      select 1 from public.email_intelligence_runs r
      where r.event_type = 'interview'
        and i.source_reference is not null
        and i.source_reference like '%' || r.id::text || '%'
    )), 0::bigint);

select test.check('intelligence', 'no application traces back to an interpretation',
  (select count(*) from public.applications a
    where exists (
      select 1 from public.email_intelligence_runs r
      where a.source_reference is not null
        and a.source_reference like '%' || r.id::text || '%'
    )), 0::bigint);

select test.check('intelligence', 'no notification was raised by an interpretation',
  (select count(*) from public.notifications
    where entity_type in ('email_intelligence_run', 'intelligence')), 0::bigint);

-- A proposal is a proposal: writing one leaves the candidate untouched.
--
-- Asserted by taking a fingerprint of the row before and after, rather than by
-- comparing timestamps — other sections of this suite legitimately edit
-- candidates, so a timestamp comparison would fail for reasons that have
-- nothing to do with interpretation.
do $$
declare
  c_priya  constant uuid := '00000000-0000-4000-a000-000000000001';
  v_before   text;
  v_after    text;
  v_run      uuid;
  v_iv_before bigint;
  v_iv_after  bigint;
begin
  select md5(to_jsonb(c)::text) into v_before from public.candidates c where c.id = c_priya;
  select count(*) into v_iv_before from public.interviews;

  insert into public.email_intelligence_runs
    (business_unit_id, email_message_id, provider, model, prompt_version, status,
     started_at, completed_at, event_type, event_confidence,
     proposed_candidate_id, candidate_match_confidence)
  values
    ('00000000-0000-4000-9000-000000000001',
     '00000000-0000-4000-9800-000000000002', 'fixture', 'x', 'v1',
     'completed', now(), now(), 'interview', 0.99, c_priya, 0.95)
  returning id into v_run;

  select md5(to_jsonb(c)::text) into v_after from public.candidates c where c.id = c_priya;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'A PROPOSED CANDIDATE WAS NOT MODIFIED',
          v_before = v_after,
          case when v_before = v_after then 'ok' else 'the candidate row changed' end);

  -- And nothing else appeared either. Counted before and after rather than by
  -- wall clock: this whole suite runs in a couple of seconds, and earlier
  -- sections legitimately create interviews of their own.
  select count(*) into v_iv_after from public.interviews;

  insert into test.results (section, name, passed, detail)
  values ('intelligence', 'STORING A PROPOSAL CREATED NO INTERVIEW',
          v_iv_before = v_iv_after,
          format('interviews before %s, after %s', v_iv_before, v_iv_after));
end $$;
