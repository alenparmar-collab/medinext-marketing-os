#!/usr/bin/env bash
# Rebuilds the local scratch database from migrations + seed. Does not run tests.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${DEV_DB:-mdx_dev}"

if [[ "$(id -u)" == "0" ]] && id postgres >/dev/null 2>&1; then
  psql_run() { su postgres -c "psql $*"; }; admin_run() { su postgres -c "$*"; }
else
  psql_run() { eval "psql $*"; }; admin_run() { eval "$*"; }
fi

admin_run "dropdb --if-exists ${DB}" >/dev/null 2>&1 || true
admin_run "createdb ${DB}"
psql_run "-q -v ON_ERROR_STOP=1 -d ${DB} -f ${ROOT}/supabase/tests/00_local_auth_shim.sql"
for f in "${ROOT}"/supabase/migrations/*.sql; do psql_run "-q -v ON_ERROR_STOP=1 -d ${DB} -f ${f}"; done
for f in "${ROOT}"/supabase/seed/*.sql;       do psql_run "-q -v ON_ERROR_STOP=1 -d ${DB} -f ${f}"; done
echo "==> ${DB} rebuilt from migrations and seed"
