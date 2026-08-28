#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Proves the RLS suite can actually fail.
#
# A green test suite means nothing if it is incapable of going red. This script
# deliberately breaks candidate isolation — the single most important guarantee
# in the system — and asserts that the suite catches it.
#
# Run it after any change to the policies or the suite itself.
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MUT_DB="${MUT_DB:-mdx_mutation_test}"

if [[ "$(id -u)" == "0" ]] && id postgres >/dev/null 2>&1; then
  psql_run() { su postgres -c "psql $*"; }
  admin_run() { su postgres -c "$*"; }
else
  psql_run() { eval "psql $*"; }
  admin_run() { eval "$*"; }
fi

echo "==> Building a database with a DELIBERATELY BROKEN isolation policy"
TEST_DB="${MUT_DB}" "${ROOT}/scripts/db-test.sh" >/dev/null 2>&1 || true

psql_run "-q -v ON_ERROR_STOP=1 -d ${MUT_DB} -c \"
  drop policy candidates_select_own on public.candidates;
  create policy candidates_select_own on public.candidates
    for select to authenticated
    using ((select util.own_candidate_id()) is not null);
\""

psql_run "-q -d ${MUT_DB} -f ${ROOT}/supabase/tests/02_rls_tests.sql" >/dev/null 2>&1 || true

CAUGHT="$(psql_run "-tA -d ${MUT_DB} -c \"
  select count(*) from test.results
   where not passed and name = 'CANDIDATE A CANNOT READ CANDIDATE B'\"" | tr -d '[:space:]')"

admin_run "dropdb --if-exists ${MUT_DB}" >/dev/null 2>&1 || true

if [[ "${CAUGHT}" == "1" ]]; then
  echo "==> PASS — the suite detects broken candidate isolation"
  exit 0
fi

echo "==> FAIL — isolation was broken and the suite did not notice."
echo "    The RLS test suite cannot be trusted until this is fixed."
exit 1
