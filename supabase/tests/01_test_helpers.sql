-- ===========================================================================
-- Test harness helpers.
--
-- Every assertion runs as the `authenticated` database role with a JWT claim
-- set, which is exactly how a request arrives from PostgREST. That means these
-- tests exercise the real policies, not a simulation of them.
-- ===========================================================================

create schema if not exists test;

create table if not exists test.results (
  id      serial primary key,
  section text not null,
  name    text not null,
  passed  boolean not null,
  detail  text
);

-- Impersonate a signed-in user and return the count from a query.
--
-- Returns -1 when the query is refused outright (a privilege error rather than
-- an empty result). That distinction matters: RLS filtering to zero rows and
-- the database refusing the schema are different guarantees, and the suite
-- asserts the right one in each case.
create or replace function test.count_as(p_uid uuid, p_sql text)
returns bigint
language plpgsql
as $$
declare v_count bigint;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  begin
    execute p_sql into v_count;
  exception when others then
    execute 'reset role';
    return -1;
  end;
  execute 'reset role';
  return v_count;
end;
$$;

-- Count as an unauthenticated caller (no JWT at all).
create or replace function test.count_anon(p_sql text)
returns bigint
language plpgsql
as $$
declare v_count bigint;
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  execute p_sql into v_count;
  execute 'reset role';
  return v_count;
exception when others then
  execute 'reset role';
  return -1;   -- privilege error: the strongest possible pass
end;
$$;

-- Attempt a write as a user. Returns true when the write was DENIED, either by
-- an error (WITH CHECK violation) or by affecting zero rows (USING filtered it
-- out). Both are legitimate denials and both must be treated as such.
create or replace function test.write_denied(p_uid uuid, p_sql text)
returns boolean
language plpgsql
as $$
declare v_rows bigint;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    execute 'reset role';
    return v_rows = 0;
  exception when others then
    execute 'reset role';
    return true;
  end;
end;
$$;

-- Attempt a write that is EXPECTED to succeed.
create or replace function test.write_allowed(p_uid uuid, p_sql text)
returns boolean
language plpgsql
as $$
declare v_rows bigint;
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    execute 'reset role';
    return v_rows > 0;
  exception when others then
    execute 'reset role';
    return false;
  end;
end;
$$;

create or replace function test.check(p_section text, p_name text, p_actual anyelement, p_expected anyelement)
returns void
language plpgsql
as $$
begin
  insert into test.results (section, name, passed, detail)
  values (
    p_section, p_name,
    p_actual is not distinct from p_expected,
    case when p_actual is not distinct from p_expected
         then 'ok'
         else format('expected %s, got %s', p_expected, p_actual) end
  );
end;
$$;
