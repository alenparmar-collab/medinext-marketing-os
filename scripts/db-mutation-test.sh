#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Proves the RLS suite can actually fail.
#
# A green test suite means nothing if it is incapable of going red. Each probe
# below deliberately breaks one of the guarantees the product depends on, and
# asserts that a specific named assertion catches it.
#
# Run after any change to the policies or the suite itself.
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MUT_DB="${MUT_DB:-mdx_mutation_test}"
FAILED=0

if [[ "$(id -u)" == "0" ]] && id postgres >/dev/null 2>&1; then
  psql_run() { su postgres -c "psql $*"; }
  admin_run() { su postgres -c "$*"; }
else
  psql_run() { eval "psql $*"; }
  admin_run() { eval "$*"; }
fi

# probe <description> <breaking SQL> <assertion name that must fail>
probe() {
  local description="$1" breaking_sql="$2" expected_failure="$3"

  admin_run "dropdb --if-exists ${MUT_DB}" >/dev/null 2>&1 || true
  TEST_DB="${MUT_DB}" "${ROOT}/scripts/db-test.sh" >/dev/null 2>&1 || true

  psql_run "-q -v ON_ERROR_STOP=1 -d ${MUT_DB} -c \"${breaking_sql}\"" >/dev/null 2>&1
  psql_run "-q -d ${MUT_DB} -f ${ROOT}/supabase/tests/02_rls_tests.sql" >/dev/null 2>&1 || true

  local caught
  caught="$(psql_run "-tA -d ${MUT_DB} -c \"
    select count(*) from test.results
     where not passed and name = '${expected_failure}'\"" | tr -d '[:space:]')"

  admin_run "dropdb --if-exists ${MUT_DB}" >/dev/null 2>&1 || true

  if [[ "${caught}" == "1" ]]; then
    printf '  PASS  %s\n' "${description}"
  else
    printf '  FAIL  %s\n' "${description}"
    printf '        the guarantee was broken and "%s" did not notice\n' "${expected_failure}"
    FAILED=$((FAILED + 1))
  fi
}

echo "==> Mutation probes (each breaks one guarantee on purpose)"

probe "candidate isolation on the candidate record" \
  "drop policy candidates_select_own on public.candidates;
   create policy candidates_select_own on public.candidates
     for select to authenticated
     using ((select util.own_candidate_id()) is not null);" \
  "CANDIDATE A CANNOT READ CANDIDATE B"

probe "candidate isolation on applications" \
  "drop policy applications_select_own on public.applications;
   create policy applications_select_own on public.applications
     for select to authenticated
     using ((select util.own_candidate_id()) is not null);" \
  "CANDIDATE A CANNOT READ APPLICATIONS OF CANDIDATE B"

probe "internal notes staying out of the portal" \
  "drop policy marketing_activities_select_own on public.marketing_activities;
   create policy marketing_activities_select_own on public.marketing_activities
     for select to authenticated
     using (candidate_id = (select util.own_candidate_id()));" \
  "CANDIDATE CANNOT READ INTERNAL NOTE ACTIVITIES"

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "==> all probes passed — the suite detects each broken guarantee"
  exit 0
fi
echo "==> ${FAILED} probe(s) failed. The RLS suite cannot be trusted until fixed."
exit 1
