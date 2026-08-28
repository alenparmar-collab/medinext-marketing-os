#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Applies the migrations and demo seed to a scratch PostgreSQL database, then
# runs the RLS and authorization suite against it.
#
# The suite runs as the real `authenticated` role with real JWT claims, so it
# exercises the actual policies rather than a simulation of them.
#
# Usage:  ./scripts/db-test.sh
# Env:    PGUSER / PGHOST / PGPORT to target a different server.
#         TEST_DB to change the scratch database name.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DB="${TEST_DB:-mdx_rls_test}"

# Run psql as the local superuser. On a developer machine that is usually the
# current user; in this container it is the `postgres` system account.
if [[ "$(id -u)" == "0" ]] && id postgres >/dev/null 2>&1; then
  psql_run() { su postgres -c "psql $*"; }
  admin_run() { su postgres -c "$*"; }
else
  psql_run() { eval "psql $*"; }
  admin_run() { eval "$*"; }
fi

# The scratch server may not be running in a fresh container. Try to bring it up
# rather than failing with a bare "connection refused".
ensure_server() {
  if psql_run "-tAc 'select 1'" >/dev/null 2>&1; then return 0; fi
  if command -v pg_ctlcluster >/dev/null 2>&1; then
    pg_ctlcluster 16 main start >/dev/null 2>&1 || true
    sleep 2
  fi
  if ! psql_run "-tAc 'select 1'" >/dev/null 2>&1; then
    echo "PostgreSQL is not reachable. Start it, or set PGHOST/PGPORT/PGUSER." >&2
    exit 1
  fi
}
ensure_server

echo "==> Recreating scratch database: ${TEST_DB}"
admin_run "dropdb --if-exists ${TEST_DB}" >/dev/null 2>&1 || true
admin_run "createdb ${TEST_DB}"

echo "==> Applying local auth shim"
psql_run "-q -v ON_ERROR_STOP=1 -d ${TEST_DB} -f ${ROOT}/supabase/tests/00_local_auth_shim.sql"

echo "==> Applying migrations"
for f in "${ROOT}"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$f")"
  psql_run "-q -v ON_ERROR_STOP=1 -d ${TEST_DB} -f ${f}"
done

echo "==> Applying demo seed"
for f in "${ROOT}"/supabase/seed/*.sql; do
  printf '    %s\n' "$(basename "$f")"
  psql_run "-q -v ON_ERROR_STOP=1 -d ${TEST_DB} -f ${f}"
done

echo "==> Running RLS and authorization suite"
psql_run "-q -v ON_ERROR_STOP=1 -d ${TEST_DB} -f ${ROOT}/supabase/tests/01_test_helpers.sql"

OUT="$(psql_run "-q -v ON_ERROR_STOP=1 -d ${TEST_DB} -f ${ROOT}/supabase/tests/02_rls_tests.sql" 2>&1 || true)"
if echo "$OUT" | grep -qiE '^(psql:|ERROR:)'; then
  echo "$OUT"
  echo "!! the suite failed to execute"
  exit 1
fi

echo
psql_run "-P pager=off -d ${TEST_DB} -c \"
  select
    lpad(row_number() over (order by id)::text, 3, ' ') as n,
    case when passed then 'PASS' else 'FAIL' end as result,
    section, name, case when passed then '' else detail end as detail
  from test.results order by id\""

FAILED="$(psql_run "-tA -d ${TEST_DB} -c 'select count(*) from test.results where not passed'" | tr -d '[:space:]')"
TOTAL="$(psql_run "-tA -d ${TEST_DB} -c 'select count(*) from test.results'" | tr -d '[:space:]')"

echo
if [[ "${FAILED}" == "0" ]]; then
  echo "==> ${TOTAL}/${TOTAL} assertions passed"
  exit 0
fi

echo "==> ${FAILED} of ${TOTAL} assertions FAILED"
psql_run "-P pager=off -d ${TEST_DB} -c \"select section, name, detail from test.results where not passed order by id\""
exit 1
