-- ===========================================================================
-- DEMO SEED, part 1 — authentication identities
--
-- DEVELOPMENT AND DEMO ONLY. Never run against production.
--
-- Every person below is fictional. No real candidate personal information
-- appears anywhere in this file.
--
-- auth.users is owned by Supabase and its columns differ between a real
-- project and the local test shim, so the insert is built dynamically from
-- whatever columns are actually present.
--
-- Demo password for every account: DemoPass123!
-- ===========================================================================

do $$
declare
  v_person record;
  v_cols   text := 'id, email';
  v_vals   text := '$1, $2';
begin
  if to_regclass('auth.users') is null then
    raise exception 'auth.users is missing — run migrations against Supabase or the local shim first';
  end if;

  -- Supabase's auth.users carries columns the local shim does not.
  -- Add each one only if it exists, so this file runs in both places.
  if exists (select 1 from information_schema.columns
             where table_schema='auth' and table_name='users' and column_name='encrypted_password') then
    v_cols := v_cols || ', encrypted_password';
    v_vals := v_vals || ', crypt(''DemoPass123!'', gen_salt(''bf''))';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema='auth' and table_name='users' and column_name='email_confirmed_at') then
    v_cols := v_cols || ', email_confirmed_at';
    v_vals := v_vals || ', now()';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema='auth' and table_name='users' and column_name='aud') then
    v_cols := v_cols || ', aud, role';
    v_vals := v_vals || ', ''authenticated'', ''authenticated''';
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema='auth' and table_name='users' and column_name='raw_app_meta_data') then
    v_cols := v_cols || ', raw_app_meta_data, raw_user_meta_data';
    v_vals := v_vals || ', ''{"provider":"email","providers":["email"]}''::jsonb, ''{}''::jsonb';
  end if;

  for v_person in
    select * from (values
      ('00000000-0000-4000-8000-000000000001'::uuid, 'admin@demo.medinext.test'),
      ('00000000-0000-4000-8000-000000000002'::uuid, 'manager@demo.medinext.test'),
      ('00000000-0000-4000-8000-000000000003'::uuid, 'recruiter.salas@demo.medinext.test'),
      ('00000000-0000-4000-8000-000000000004'::uuid, 'recruiter.halvorsen@demo.medinext.test'),
      ('00000000-0000-4000-8000-000000000005'::uuid, 'recruiter.rossi@demo.medinext.test'),
      ('00000000-0000-4000-8000-000000000011'::uuid, 'priya.raman@demo.medinext.test'),
      ('00000000-0000-4000-8000-000000000013'::uuid, 'lucia.ferrari@demo.medinext.test')
    ) as t(id, email)
  loop
    execute format(
      'insert into auth.users (%s) values (%s) on conflict (id) do nothing',
      v_cols, v_vals
    ) using v_person.id, v_person.email;
  end loop;
end;
$$;
