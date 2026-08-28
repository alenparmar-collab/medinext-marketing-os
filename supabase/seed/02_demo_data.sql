-- ===========================================================================
-- DEMO SEED, part 2 — business data
--
-- DEVELOPMENT AND DEMO ONLY. Every person, company, skill and location below
-- is fictional. No real candidate personal information appears in this file.
--
-- The shape is chosen to make the permission model testable rather than to
-- look impressive:
--
--   * TWO business units, so cross-tenant isolation has something to fail on.
--   * A candidate assigned to recruiter A and another assigned to recruiter B,
--     so "recruiter sees only their own" is falsifiable.
--   * An UNASSIGNED candidate, so "manager sees all, recruiter sees none of
--     this one" is falsifiable.
--   * TWO candidates with portal logins, so "candidate A cannot read candidate
--     B" is falsifiable — which is the single most important assertion in the
--     suite.
--   * Documents in both visibilities, so publication is falsifiable.
--
-- Idempotent: safe to run repeatedly.
-- ===========================================================================

-- Seed writes are attributed to a system actor rather than left anonymous.
select set_config('app.source', 'seed', false);

-- ---------------------------------------------------------------------------
-- Business units
-- ---------------------------------------------------------------------------
insert into public.business_units (id, code, name) values
  ('00000000-0000-4000-9000-000000000001', 'MDX-EU',   'MediNext Europe'),
  ('00000000-0000-4000-9000-000000000002', 'MDX-APAC', 'MediNext Asia-Pacific')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Internal users
-- ---------------------------------------------------------------------------
insert into public.users (id, business_unit_id, email, full_name, job_title, status) values
  ('00000000-0000-4000-8000-000000000001', null,
   'admin@demo.medinext.test', 'Amara Osei', 'Platform Administrator', 'active'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-9000-000000000001',
   'manager@demo.medinext.test', 'Rosalind Vega', 'Marketing Manager', 'active'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-9000-000000000001',
   'recruiter.salas@demo.medinext.test', 'Teodoro Salas', 'Recruiter', 'active'),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-9000-000000000001',
   'recruiter.halvorsen@demo.medinext.test', 'Ingrid Halvorsen', 'Recruiter', 'active'),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-9000-000000000002',
   'recruiter.rossi@demo.medinext.test', 'Bianca Rossi', 'Recruiter', 'active')
on conflict (id) do nothing;

-- Portal accounts for two candidates.
insert into public.users (id, business_unit_id, email, full_name, status) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-9000-000000000001',
   'priya.raman@demo.medinext.test', 'Priya Raman', 'active'),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-9000-000000000001',
   'lucia.ferrari@demo.medinext.test', 'Lucia Ferrari', 'active')
on conflict (id) do nothing;

insert into public.user_roles (user_id, role_code) values
  ('00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'manager'),
  ('00000000-0000-4000-8000-000000000003', 'recruiter'),
  ('00000000-0000-4000-8000-000000000004', 'recruiter'),
  ('00000000-0000-4000-8000-000000000005', 'recruiter'),
  ('00000000-0000-4000-8000-000000000011', 'candidate'),
  ('00000000-0000-4000-8000-000000000013', 'candidate')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Candidates
--
-- Note the spread of preferred_locations: some set, some empty. Nothing in the
-- system requires it, and nothing compares it to current_location.
-- ---------------------------------------------------------------------------
insert into public.candidates (
  id, business_unit_id, reference, user_id, full_name, email, phone,
  primary_skill, skills, total_experience_months, current_location,
  visa_status, education, certifications, preferred_locations,
  marketing_status, created_source, created_by
) values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-4000-9000-000000000001',
   'MDX-00001', '00000000-0000-4000-8000-000000000011',
   'Priya Raman', 'priya.raman@demo.medinext.test', '+44 20 7946 0011',
   'Clinical Data Management', array['Clinical Data Management','SAS','CDISC'], 78, 'Manchester, UK',
   'Skilled Worker visa', 'MSc Bioinformatics, University of Leeds',
   array['CDISC SDTM Practitioner'], array['London, UK','Remote'],
   'active', 'seed', '00000000-0000-4000-8000-000000000002'),

  ('00000000-0000-4000-a000-000000000002', '00000000-0000-4000-9000-000000000001',
   'MDX-00002', null,
   'Kwame Boateng', 'kwame.boateng@demo.medinext.test', '+44 20 7946 0022',
   'Regulatory Affairs', array['Regulatory Affairs','eCTD','MHRA submissions'], 132, 'Birmingham, UK',
   'Indefinite leave to remain', 'BPharm, University of Birmingham',
   array['RAPS RAC'], '{}',
   'ready_for_marketing', 'seed', '00000000-0000-4000-8000-000000000002'),

  ('00000000-0000-4000-a000-000000000003', '00000000-0000-4000-9000-000000000001',
   'MDX-00003', '00000000-0000-4000-8000-000000000013',
   'Lucia Ferrari', 'lucia.ferrari@demo.medinext.test', '+44 20 7946 0033',
   'Pharmacovigilance', array['Pharmacovigilance','Argus Safety','Signal detection'], 54, 'Dublin, IE',
   'EU citizen', 'MSc Pharmacology, Trinity College Dublin',
   '{}', array['Dublin, IE'],
   'active', 'seed', '00000000-0000-4000-8000-000000000002'),

  ('00000000-0000-4000-a000-000000000004', '00000000-0000-4000-9000-000000000001',
   'MDX-00004', null,
   'Dmitri Volkov', 'dmitri.volkov@demo.medinext.test', '+44 20 7946 0044',
   'Biostatistics', array['Biostatistics','R','Survival analysis'], 96, 'Edinburgh, UK',
   'Global Talent visa', 'PhD Statistics, University of Edinburgh',
   '{}', '{}',
   'onboarding', 'seed', '00000000-0000-4000-8000-000000000002'),

  -- Deliberately unassigned: proves a manager sees candidates a recruiter cannot.
  ('00000000-0000-4000-a000-000000000005', '00000000-0000-4000-9000-000000000001',
   'MDX-00005', null,
   'Naomi Adeyemi', 'naomi.adeyemi@demo.medinext.test', '+44 20 7946 0055',
   'Medical Writing', array['Medical Writing','CSR authoring'], 60, 'Bristol, UK',
   'Skilled Worker visa', 'MSc Medical Writing, University of Bristol',
   '{}', array['Remote'],
   'on_hold', 'seed', '00000000-0000-4000-8000-000000000002'),

  -- Different business unit: proves the tenant boundary holds.
  ('00000000-0000-4000-a000-000000000006', '00000000-0000-4000-9000-000000000002',
   'MDX-00006', null,
   'Hiroshi Tanaka', 'hiroshi.tanaka@demo.medinext.test', '+81 3 5555 0066',
   'Clinical Operations', array['Clinical Operations','GCP','Site management'], 108, 'Osaka, JP',
   'Japanese citizen', 'BSc Life Sciences, Osaka University',
   array['GCP certified'], '{}',
   'active', 'seed', '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- Keep the reference sequence ahead of the hand-written references above.
select setval('public.candidate_reference_seq', 100, false);

-- ---------------------------------------------------------------------------
-- Assignments
--   Salas     -> Priya, Kwame
--   Halvorsen -> Lucia, Dmitri
--   Naomi     -> nobody
--   Rossi     -> Hiroshi (other business unit)
-- ---------------------------------------------------------------------------
insert into public.candidate_assignments
  (id, business_unit_id, candidate_id, user_id, assignment_type, starts_on, created_by) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000003',
   'primary_recruiter', current_date - 60, '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-8000-000000000003',
   'primary_recruiter', current_date - 40, '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', '00000000-0000-4000-8000-000000000004',
   'primary_recruiter', current_date - 30, '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-8000-000000000004',
   'primary_recruiter', current_date - 10, '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-b000-000000000005', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-a000-000000000006', '00000000-0000-4000-8000-000000000005',
   'primary_recruiter', current_date - 20, '00000000-0000-4000-8000-000000000001'),
  -- The manager oversees one file directly, exercising the 'manager' type.
  ('00000000-0000-4000-b000-000000000006', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', '00000000-0000-4000-8000-000000000002',
   'manager', current_date - 60, '00000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Marketing periods
-- ---------------------------------------------------------------------------
insert into public.marketing_periods
  (id, business_unit_id, candidate_id, starts_on, status, objective, opened_by) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', current_date - 55, 'active',
   'Clinical data management roles, UK and remote.', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000002', current_date - 35, 'ready_for_marketing',
   'Regulatory affairs, UK submissions experience.', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', current_date - 25, 'active',
   'Pharmacovigilance, Ireland.', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000005', current_date - 90, 'on_hold',
   'Medical writing. Paused at the candidate''s request.', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-9000-000000000002',
   '00000000-0000-4000-a000-000000000006', current_date - 18, 'active',
   'Clinical operations, Japan.', '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

-- A closed historical period on Priya, proving one candidate carries several.
insert into public.marketing_periods
  (id, business_unit_id, candidate_id, starts_on, ends_on, status, objective, opened_by, closed_by, closed_at) values
  ('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', current_date - 400, current_date - 300, 'completed',
   'Previous engagement, closed.', '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000002', now() - interval '300 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Documents
--
-- Priya has one published and one internal-only document. That pair is what
-- the storage/visibility assertions test against.
-- ---------------------------------------------------------------------------
insert into public.documents (
  id, business_unit_id, candidate_id, document_type, file_name, storage_path,
  mime_type, size_bytes, checksum_sha256, visibility, uploaded_by
) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', 'resume', 'priya-raman-resume.pdf',
   '00000000-0000-4000-a000-000000000001/resume/00000000-0000-4000-d000-000000000001-priya-raman-resume.pdf',
   'application/pdf', 184320, repeat('a', 64), 'candidate_visible',
   '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001', 'formatted_resume', 'priya-raman-formatted-internal.pdf',
   '00000000-0000-4000-a000-000000000001/formatted_resume/00000000-0000-4000-d000-000000000002-priya-raman-formatted-internal.pdf',
   'application/pdf', 201728, repeat('b', 64), 'internal',
   '00000000-0000-4000-8000-000000000003'),

  ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000003', 'resume', 'lucia-ferrari-resume.pdf',
   '00000000-0000-4000-a000-000000000003/resume/00000000-0000-4000-d000-000000000003-lucia-ferrari-resume.pdf',
   'application/pdf', 176128, repeat('c', 64), 'candidate_visible',
   '00000000-0000-4000-8000-000000000004')
on conflict (id) do nothing;

update public.candidates
   set primary_resume_document_id = '00000000-0000-4000-d000-000000000001'
 where id = '00000000-0000-4000-a000-000000000001'
   and primary_resume_document_id is null;

update public.candidates
   set primary_resume_document_id = '00000000-0000-4000-d000-000000000003'
 where id = '00000000-0000-4000-a000-000000000003'
   and primary_resume_document_id is null;

-- ---------------------------------------------------------------------------
-- Internal notes — the payload that must never reach a candidate.
-- ---------------------------------------------------------------------------
insert into public.candidate_internal_notes (id, business_unit_id, candidate_id, body, created_by) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-9000-000000000001',
   '00000000-0000-4000-a000-000000000001',
   'INTERNAL ONLY — demo note. If this string is ever visible in the candidate portal, the RLS test suite has failed.',
   '00000000-0000-4000-8000-000000000003')
on conflict (id) do nothing;

select set_config('app.source', '', false);
