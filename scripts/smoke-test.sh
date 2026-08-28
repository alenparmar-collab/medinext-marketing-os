#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# HTTP smoke test against a production build.
#
# Verifies the request-layer guarantees unit tests cannot: that every protected
# route refuses an unauthenticated caller, that sign-out cannot be triggered by
# a GET (a prefetch or an <img> would otherwise log people out), and that the
# security headers are actually on the wire.
#
# Run `npm run build` first. Real Supabase credentials are NOT required: with
# placeholder values the auth lookup fails, the actor resolves to null, and the
# redirect behaviour under test is exactly what an anonymous visitor gets.
#
# Note the [n] in the pkill patterns. `pkill -f` matches full command lines,
# including this script's own, so an unbracketed pattern makes the script kill
# itself.
# ---------------------------------------------------------------------------
set -uo pipefail

PORT="${PORT:-3111}"
BASE="http://localhost:${PORT}"
FAILED=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s (%s)\n' "$1" "$2"; FAILED=$((FAILED + 1)); }
stop_server() { pkill -f "[n]ext start -p ${PORT}" >/dev/null 2>&1 || true; }

stop_server
# Fully detached: a backgrounded job plus an EXIT trap can take the calling
# shell down with it in some sandboxes.
( npx next start -p "${PORT}" >/tmp/medinext-smoke.log 2>&1 & )

for _ in $(seq 1 40); do
  curl -sf "${BASE}/api/health" >/dev/null 2>&1 && break
  sleep 1
done

if ! curl -sf "${BASE}/api/health" >/dev/null 2>&1; then
  echo "  server did not start; see /tmp/medinext-smoke.log"
  tail -20 /tmp/medinext-smoke.log
  stop_server
  exit 1
fi

echo "==> Public endpoints"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/health")" == "200" ]] \
  && pass "health check responds" || fail "health check responds" "not 200"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/sign-in")" == "200" ]] \
  && pass "sign-in page is reachable" || fail "sign-in page is reachable" "not 200"

echo "==> Protected routes refuse an unauthenticated caller"
for path in / /overview /candidates /candidates/new /marketing /settings /team \
            /portal /portal/profile /portal/marketing /portal/documents; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${path}")"
  target="$(curl -s -o /dev/null -w '%{redirect_url}' "${BASE}${path}")"
  if [[ "${code}" == "307" && "${target}" == *"/sign-in"* ]]; then
    pass "${path} redirects to sign-in"
  else
    fail "${path} redirects to sign-in" "got ${code} -> ${target:-none}"
  fi
done

echo "==> Sign-out is POST only"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/auth/sign-out")" == "405" ]] \
  && pass "GET /auth/sign-out is rejected" || fail "GET /auth/sign-out is rejected" "expected 405"

echo "==> Security headers"
HEADERS="$(curl -s -D- -o /dev/null "${BASE}/sign-in")"
for h in X-Content-Type-Options X-Frame-Options Referrer-Policy Permissions-Policy; do
  grep -qi "^${h}:" <<<"${HEADERS}" && pass "${h} present" || fail "${h} present" "missing"
done
if grep -qi '^x-powered-by:' <<<"${HEADERS}"; then
  fail "X-Powered-By is suppressed" "header present"
else
  pass "X-Powered-By is suppressed"
fi

stop_server

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "==> smoke test passed"
  exit 0
fi
echo "==> ${FAILED} smoke assertion(s) failed"
exit 1
