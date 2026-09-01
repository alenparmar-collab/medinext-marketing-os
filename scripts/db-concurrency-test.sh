#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Concurrency test — intelligence run numbering.
#
# 0034 allocated `run_number` with `select max(run_number) + 1`, which is a
# read-then-write race: two transactions read the same maximum, both write the
# same number, and one dies on the unique constraint. 0036 replaced it with a
# transaction-scoped advisory lock keyed on the email, so the allocation is
# serialised per message rather than per table.
#
# A claim about concurrency is only worth what a concurrent test says, so this
# script runs real parallel psql sessions released from a common starting gate
# (they all sleep until the same wall-clock instant) rather than simulating
# contention.
#
#   PHASE A  N sessions insert a terminal run for the same email at once.
#            All N must succeed with run numbers exactly 1..N.
#   PHASE B  N sessions insert an ACTIVE run for the same email at once.
#            Exactly one may win, and every loser must fail on the
#            one-active-run index — the meaningful, retryable domain error —
#            never on a duplicate run number.
#   PHASE C  Non-vacuity. Restore the unguarded max+1 allocator and re-run
#            phase A: it must break. A concurrency test that cannot detect the
#            bug it was written for is decoration.
#
# Usage:  ./scripts/db-concurrency-test.sh
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CON_DB="${CON_DB:-mdx_concurrency_test}"
WORKERS="${WORKERS:-12}"
WORK="$(mktemp -d)"
FAILED=0

trap 'rm -rf "${WORK}"' EXIT

if [[ "$(id -u)" == "0" ]] && id postgres >/dev/null 2>&1; then
  psql_run() { su postgres -c "psql $*"; }
  admin_run() { su postgres -c "$*"; }
  # The children write their transcripts into a shared directory; postgres has
  # to be able to read the SQL and write the output.
  chmod 777 "${WORK}"
else
  psql_run() { eval "psql $*"; }
  admin_run() { eval "$*"; }
fi

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n         %s\n' "$1" "${2:-}"; FAILED=$((FAILED + 1)); }

# ---------------------------------------------------------------------------
# A scratch database of its own, so a half-finished race never leaks into the
# RLS suite's fixtures.
# ---------------------------------------------------------------------------
echo "==> Building scratch database: ${CON_DB}"
admin_run "dropdb --if-exists ${CON_DB}" >/dev/null 2>&1 || true
CON_OUT="$(TEST_DB="${CON_DB}" "${ROOT}/scripts/db-test.sh" 2>&1)"
if ! echo "${CON_OUT}" | grep -q 'assertions passed'; then
  echo "${CON_OUT}" | tail -20
  echo "!! could not build the scratch database"
  exit 1
fi

# The email every worker will race on. Any seeded message will do; the run
# numbers are asserted relative to what is already there.
read -r MSG_ID UNIT_ID <<<"$(psql_run "-tA -F' ' -d ${CON_DB} -c \"
  select m.id, m.business_unit_id
    from public.email_messages m
   order by m.received_at desc
   limit 1\"" | tr -d '\r')"

if [[ -z "${MSG_ID:-}" ]]; then
  echo "!! no seeded email message to race on"
  exit 1
fi

baseline() {
  psql_run "-tA -d ${CON_DB} -c \"
    select coalesce(max(run_number), 0) from public.email_intelligence_runs
     where email_message_id = '${MSG_ID}'\"" | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# The starting gate.
#
# Each worker sleeps until a shared epoch second, so the inserts land inside
# the same few milliseconds. Staggered workers would serialise themselves and
# the test would pass with no allocator at all.
# ---------------------------------------------------------------------------
race() {
  local status="$1" completed="$2" gate i pid rc
  gate="$(psql_run "-tA -d ${CON_DB} -c 'select extract(epoch from clock_timestamp()) + 3'" | tr -d '[:space:]')"

  rm -f "${WORK}"/worker_*.out "${WORK}"/worker_*.rc

  cat > "${WORK}/insert.sql" <<SQL
select pg_sleep(greatest(0, ${gate} - extract(epoch from clock_timestamp())::float8));
insert into public.email_intelligence_runs
  (business_unit_id, email_message_id, provider, model, prompt_version,
   status, completed_at)
values
  ('${UNIT_ID}', '${MSG_ID}', 'fixture', 'concurrency-probe', 'email_intelligence_v1',
   '${status}', ${completed});
SQL
  chmod 644 "${WORK}/insert.sql"

  for ((i = 0; i < WORKERS; i++)); do
    (
      psql_run "-q -v ON_ERROR_STOP=1 -d ${CON_DB} -f ${WORK}/insert.sql" \
        >"${WORK}/worker_${i}.out" 2>&1
      echo "$?" > "${WORK}/worker_${i}.rc"
    ) &
  done
  wait
}

winners() { cat "${WORK}"/worker_*.rc | grep -c '^0$' || true; }
losers()  { cat "${WORK}"/worker_*.rc | grep -vc '^0$' || true; }
# Written to a file rather than piped: `grep -q` closes the pipe on its first
# match, `cat` takes SIGPIPE, and `pipefail` then reports the pipeline as failed
# even though the pattern WAS found — which is exactly backwards for a check
# that is looking for an error message.
errors()  { cat "${WORK}"/worker_*.out 2>/dev/null > "${WORK}/errors.txt"; }

# ---------------------------------------------------------------------------
# PHASE A — every concurrent terminal run gets its own number.
# ---------------------------------------------------------------------------
echo
echo "==> Phase A: ${WORKERS} concurrent runs on one email"
BASE="$(baseline)"
race ignored "now()"

OK="$(winners)"
if [[ "${OK}" == "${WORKERS}" ]]; then
  pass "all ${WORKERS} concurrent inserts succeeded"
else
  errors
  fail "all ${WORKERS} concurrent inserts succeeded" \
    "only ${OK} did: $(grep -i error "${WORK}/errors.txt" | head -2)"
fi

NUMBERS="$(psql_run "-tA -d ${CON_DB} -c \"
  select string_agg(run_number::text, ',' order by run_number)
    from public.email_intelligence_runs
   where email_message_id = '${MSG_ID}' and model = 'concurrency-probe'\"" | tr -d '[:space:]')"
EXPECTED="$(psql_run "-tA -d ${CON_DB} -c \"
  select string_agg(n::text, ',' order by n)
    from generate_series(${BASE} + 1, ${BASE} + ${WORKERS}) as n\"" | tr -d '[:space:]')"

if [[ "${NUMBERS}" == "${EXPECTED}" ]]; then
  pass "run numbers are a gapless unique sequence (${NUMBERS})"
else
  fail "run numbers are a gapless unique sequence" "expected ${EXPECTED}, got ${NUMBERS}"
fi

# ---------------------------------------------------------------------------
# PHASE B — the one-active-run guarantee survives the race, and the losers
# fail for the RIGHT reason.
#
# Only one run may be in flight per email. Under the old allocator the losers
# died on `email_intelligence_runs_email_message_id_run_number_key`, which
# reads as an internal numbering bug; under the new one they die on
# `email_intelligence_runs_one_active`, which is the real rule and is what a
# retry should be written against.
# ---------------------------------------------------------------------------
echo
echo "==> Phase B: ${WORKERS} concurrent ACTIVE runs on one email"
psql_run "-q -d ${CON_DB} -c \"
  delete from public.email_intelligence_runs where model = 'concurrency-probe'\"" >/dev/null 2>&1
race pending "null"

OK="$(winners)"
if [[ "${OK}" == "1" ]]; then
  pass "exactly one run was allowed in flight"
else
  fail "exactly one run was allowed in flight" "${OK} of ${WORKERS} inserts succeeded"
fi

errors
if grep -q 'email_intelligence_runs_one_active' "${WORK}/errors.txt"; then
  pass "the losers were refused by the one-active-run index"
else
  fail "the losers were refused by the one-active-run index" \
    "$(grep -i 'ERROR' "${WORK}/errors.txt" | head -1)"
fi

if grep -qi 'run_number_key' "${WORK}/errors.txt"; then
  fail "no loser died on a duplicate run number" \
    "$(grep -i 'run_number_key' "${WORK}/errors.txt" | head -1)"
else
  pass "no loser died on a duplicate run number"
fi

# ---------------------------------------------------------------------------
# PHASE C — non-vacuity.
#
# Put the unguarded allocator back and run phase A again. If the race still
# comes out clean, this script is not testing anything and says so.
# ---------------------------------------------------------------------------
echo
echo "==> Phase C: the same race against the unguarded max+1 allocator"
psql_run "-q -d ${CON_DB} -c \"
  delete from public.email_intelligence_runs where model = 'concurrency-probe'\"" >/dev/null 2>&1

cat > "${WORK}/unguarded.sql" <<'SQL'
create or replace function util.tg_email_intelligence_run_number()
returns trigger
language plpgsql
as $$
begin
  if new.run_number is null or new.run_number = 1 then
    select coalesce(max(r.run_number), 0) + 1
      into new.run_number
      from public.email_intelligence_runs r
     where r.email_message_id = new.email_message_id;
  end if;
  return new;
end;
$$;
SQL
chmod 644 "${WORK}/unguarded.sql"
psql_run "-q -v ON_ERROR_STOP=1 -d ${CON_DB} -f ${WORK}/unguarded.sql" >/dev/null 2>&1

RACED=0
for attempt in 1 2 3; do
  psql_run "-q -d ${CON_DB} -c \"
    delete from public.email_intelligence_runs where model = 'concurrency-probe'\"" >/dev/null 2>&1
  race ignored "now()"
  if [[ "$(losers)" != "0" ]]; then
    RACED=1
    printf '        round %s: %s of %s inserts lost the race\n' "${attempt}" "$(losers)" "${WORKERS}"
    break
  fi
  printf '        round %s: no collision, retrying\n' "${attempt}"
done

if [[ "${RACED}" == "1" ]]; then
  pass "the unguarded allocator loses the race, so phase A is a real test"
else
  fail "the unguarded allocator loses the race" \
    "three rounds of ${WORKERS} concurrent inserts produced no collision; phase A may be vacuous"
fi

admin_run "dropdb --if-exists ${CON_DB}" >/dev/null 2>&1 || true

echo
if [[ "${FAILED}" == "0" ]]; then
  echo "==> concurrency: all checks passed"
  exit 0
fi
echo "==> concurrency: ${FAILED} check(s) FAILED"
exit 1
