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
\set APP_PRIYA_1 00000000-0000-4000-f000-000000000001
\set APP_LUCIA_1 00000000-0000-4000-f000-000000000007
\set APP_NAOMI   00000000-0000-4000-f000-00000000000b
\set APP_HIROSHI 00000000-0000-4000-f000-00000000000c
\set ACT_NOTE    00000000-0000-4000-1000-000000000006

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

select test.check('scope', 'recruiter Salas sees only their 2 assigned candidates',
  test.count_as(:'SALAS', 'select count(*) from public.candidates'), 2::bigint);

select test.check('scope', 'recruiter Halvorsen sees only their 2 assigned candidates',
  test.count_as(:'HALVORSEN', 'select count(*) from public.candidates'), 2::bigint);

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
  test.count_as(:'ADMIN', 'select count(*) from public.applications'), 12::bigint);

select test.check('applications', 'manager sees their unit''s 11 applications only',
  test.count_as(:'MANAGER', 'select count(*) from public.applications'), 11::bigint);

select test.check('applications', 'recruiter Salas sees only their candidates'' 6 applications',
  test.count_as(:'SALAS', 'select count(*) from public.applications'), 6::bigint);

select test.check('applications', 'recruiter Halvorsen sees only their candidates'' 4 applications',
  test.count_as(:'HALVORSEN', 'select count(*) from public.applications'), 4::bigint);

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
select test.check('isolation', 'candidate Priya sees her own 4 applications',
  test.count_as(:'PRIYA_USER', 'select count(*) from public.applications'), 4::bigint);

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
    'select count(*) from public.applications where company_name is not null'), 4::bigint);

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
  values ('00000000-0000-4000-1000-0000000000ff',
          '00000000-0000-4000-9000-000000000001',
          '00000000-0000-4000-a000-000000000001',
          'note', 'attempted candidate-visible note', 'candidate_visible',
          '00000000-0000-4000-8000-000000000003');

  select visibility into v_vis from public.marketing_activities
   where id = '00000000-0000-4000-1000-0000000000ff';

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
    where application_id = '00000000-0000-4000-f000-000000000001'
      and to_status = 'screening'
      and changed_by = '00000000-0000-4000-8000-000000000003'), true);

select test.check('automation', 'the recruiter status change above wrote a status_change activity',
  (select count(*) > 0 from public.marketing_activities
    where application_id = '00000000-0000-4000-f000-000000000001'
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
  5::bigint);

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
     ('applications'),('marketing_activities')) as t(tbl)
   where not exists (
     select 1 from information_schema.columns
      where table_schema='public' and table_name=t.tbl and column_name='business_unit_id'
   )), 0::bigint);

select test.check('structure', 'every audited business table has the audit trigger',
  (select count(*) from (values
     ('candidates'),('candidate_assignments'),('marketing_periods'),
     ('documents'),('users'),('user_roles'),('candidate_internal_notes'),
     ('applications'),('marketing_activities'),('application_status_history')) as t(tbl)
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
