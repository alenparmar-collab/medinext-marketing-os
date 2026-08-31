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

  # A probe body starting with @ names a file, because nested shell quoting
  # mangles anything containing dollar-quoted function bodies.
  if [[ "${breaking_sql}" == @* ]]; then
    psql_run "-q -v ON_ERROR_STOP=1 -d ${MUT_DB} -f ${ROOT}/${breaking_sql#@}" >/dev/null 2>&1
  else
    psql_run "-q -v ON_ERROR_STOP=1 -d ${MUT_DB} -c \"${breaking_sql}\"" >/dev/null 2>&1
  fi
  psql_run "-q -d ${MUT_DB} -f ${ROOT}/supabase/tests/02_rls_tests.sql" >/dev/null 2>&1 || true

  local caught escaped
  escaped="${expected_failure//\'/\'\'}"
  caught="$(psql_run "-tA -d ${MUT_DB} -c \"
    select count(*) from test.results
     where not passed and name = '${escaped}'\"" | tr -d '[:space:]')"

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

probe "candidate isolation on interviews" \
  "drop policy interviews_select_own on public.interviews;
   create policy interviews_select_own on public.interviews
     for select to authenticated
     using ((select util.own_candidate_id()) is not null);" \
  "CANDIDATE A CANNOT READ INTERVIEWS OF CANDIDATE B"

probe "candidate isolation on assessments" \
  "drop policy assessments_select_own on public.assessments;
   create policy assessments_select_own on public.assessments
     for select to authenticated
     using ((select util.own_candidate_id()) is not null);" \
  "CANDIDATE A CANNOT READ ASSESSMENTS OF CANDIDATE B"

probe "notification privacy" \
  "drop policy notifications_select_own on public.notifications;
   create policy notifications_select_own on public.notifications
     for select to authenticated using (true);" \
  "CANDIDATE A CANNOT READ NOTIFICATIONS OF CANDIDATE B"

probe "stored files staying private between candidates" \
  "drop policy documents_read_own on storage.objects;
   create policy documents_read_own on storage.objects
     for select to authenticated
     using (bucket_id = 'candidate-documents' and (select util.own_candidate_id()) is not null);" \
  "CANDIDATE A CANNOT READ STORED FILES OF CANDIDATE B"

probe "notification idempotency" \
  "@supabase/tests/mutations/notification_idempotency.sql" \
  "DUPLICATE NOTIFICATIONS ARE PREVENTED FOR A REPEATED EVENT"

probe "daily reports staying private between recruiters" \
  "@supabase/tests/mutations/report_isolation.sql" \
  "RECRUITER CANNOT READ THE REPORT OF ANOTHER RECRUITER"

probe "report figures being derived rather than typed" \
  "@supabase/tests/mutations/report_snapshot.sql" \
  "A CONFIRMED SNAPSHOT EQUALS THE DERIVED FIGURES"

probe "the review queue staying internal only" \
  "drop policy review_items_select on public.review_items;
   create policy review_items_select on public.review_items
     for select to authenticated using (true);" \
  "REVIEW QUEUE IS INTERNAL ONLY — candidate sees nothing"

# Both the missing GRANT and the missing policy have to go: leaving either in
# place means the delete still fails and the guarantee is never actually broken.
probe "review history being undeletable" \
  "grant delete on public.review_items to authenticated;
   create policy review_items_delete on public.review_items
     for delete to authenticated using (true);" \
  "REVIEW HISTORY CANNOT BE DELETED"

probe "managers being unable to create an administrator" \
  "insert into public.role_permissions (role_code, permission_code)
     values ('manager', 'role.manage') on conflict do nothing;
   drop trigger guard_admin_grant on public.user_roles;" \
  "MANAGER CANNOT CREATE AN ADMIN"

probe "users being unable to change their own account status" \
  "drop trigger guard_user_self_update on public.users;" \
  "A USER CANNOT CHANGE THEIR OWN ACCOUNT STATUS"

probe "a transfer moving a candidate rather than adding an owner" \
  "@supabase/tests/mutations/assignment_transfer.sql" \
  "A TRANSFER LEAVES EXACTLY ONE ACTIVE PRIMARY RECRUITER"

probe "report figures following responsibility rather than keystrokes" \
  "@supabase/tests/mutations/attribution_by_creator.sql" \
  "ATTRIBUTION BY OWNERSHIP DIFFERS FROM ATTRIBUTION BY CREATOR"

probe "ownership being derived rather than taken from the payload" \
  "@supabase/tests/mutations/attribution_trusts_payload.sql" \
  "A SUPPLIED RESPONSIBLE RECRUITER IS DISCARDED, NOT TRUSTED"

probe "historical ownership surviving a reassignment" \
  "@supabase/tests/mutations/attribution_follows_current.sql" \
  "HISTORICAL RECORDS KEEP THE RECRUITER WHO OWNED THEM AT THE TIME"

probe "ownership being uneditable after the event" \
  "@supabase/tests/mutations/attribution_editable.sql" \
  "A RECRUITER CANNOT REATTRIBUTE A HISTORICAL RECORD TO THEMSELVES"

probe "a handover not erasing the previous recruiter's own figures" \
  "@supabase/tests/mutations/metrics_invoker.sql" \
  "A HANDOVER DOES NOT ERASE THE FIGURES OF THE PREVIOUS RECRUITER"

probe "figures staying private between recruiters" \
  "@supabase/tests/mutations/metrics_ungated.sql" \
  "A RECRUITER CANNOT READ THE FIGURES OF A COLLEAGUE"

probe "cross-candidate attachment being structurally impossible" \
  "alter table public.interviews
     drop constraint interviews_application_id_candidate_id_fkey;
   alter table public.marketing_activities
     drop constraint marketing_activities_application_id_candidate_id_fkey;" \
  "INTERVIEW CANNOT BE ATTACHED ACROSS CANDIDATES"

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "==> all probes passed — the suite detects each broken guarantee"
  exit 0
fi
echo "==> ${FAILED} probe(s) failed. The RLS suite cannot be trusted until fixed."
exit 1
