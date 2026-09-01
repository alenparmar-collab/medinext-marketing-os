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
# Stopping the server is done BY PORT, not by command line. `next start` execs
# a process whose title is "next-server (vX.Y.Z)" — it does not contain the
# argv the script launched it with — so a pkill pattern never matches it and a
# stale server survives to hold the port. The next run then fails to bind and
# silently tests the OLD build, which is how a green smoke test can be a lie.
#
# The pkill remains as a fallback for systems without fuser. Note the [n]:
# `pkill -f` matches full command lines including this script's own, so an
# unbracketed pattern makes the script kill itself.
# ---------------------------------------------------------------------------
set -uo pipefail

PORT="${PORT:-3111}"
BASE="http://localhost:${PORT}"
FAILED=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s (%s)\n' "$1" "$2"; FAILED=$((FAILED + 1)); }
stop_server() {
  fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
  pkill -f "[n]ext start -p ${PORT}" >/dev/null 2>&1 || true
  # Give the socket a moment to be released before the next bind.
  for _ in $(seq 1 10); do
    fuser "${PORT}/tcp" >/dev/null 2>&1 || return 0
    sleep 0.3
  done
}

stop_server
# Fully detached: a backgrounded job plus an EXIT trap can take the calling
# shell down with it in some sandboxes.
( npx next start -p "${PORT}" >/tmp/medinext-smoke.log 2>&1 & )

for _ in $(seq 1 40); do
  curl -sf "${BASE}/api/health" >/dev/null 2>&1 && break
  sleep 1
done

if grep -q 'EADDRINUSE' /tmp/medinext-smoke.log 2>/dev/null; then
  echo "  port ${PORT} was still held by an older server; refusing to test a stale build"
  stop_server
  exit 1
fi

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
            /applications /applications/new /interviews /interviews/new \
            /assessments /assessments/new /notifications \
            /reports /reports/daily /reports/daily/new /reports/daily/today /review \
            /emails /settings/mailbox \
            /portal /portal/profile /portal/marketing /portal/documents \
            /portal/applications /portal/activity /portal/interviews \
            /portal/assessments /portal/notifications; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}${path}")"
  target="$(curl -s -o /dev/null -w '%{redirect_url}' "${BASE}${path}")"
  if [[ "${code}" == "307" && "${target}" == *"/sign-in"* ]]; then
    pass "${path} redirects to sign-in"
  else
    fail "${path} redirects to sign-in" "got ${code} -> ${target:-none}"
  fi
done

echo "==> Mailbox OAuth refuses an unauthenticated caller"
OAUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/mailbox/oauth/start")"
OAUTH_TARGET="$(curl -s -o /dev/null -w '%{redirect_url}' "${BASE}/api/mailbox/oauth/start")"
if [[ "${OAUTH_CODE}" == "307" && "${OAUTH_TARGET}" == *"/sign-in"* ]]; then
  pass "OAuth start redirects an anonymous caller to sign-in"
else
  fail "OAuth start redirects an anonymous caller to sign-in" "got ${OAUTH_CODE} -> ${OAUTH_TARGET:-none}"
fi

CB_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/mailbox/oauth/callback?code=x&state=y")"
CB_TARGET="$(curl -s -o /dev/null -w '%{redirect_url}' "${BASE}/api/mailbox/oauth/callback?code=x&state=y")"
if [[ "${CB_CODE}" == "307" && "${CB_TARGET}" == *"/sign-in"* ]]; then
  pass "OAuth callback refuses an anonymous caller"
else
  fail "OAuth callback refuses an anonymous caller" "got ${CB_CODE} -> ${CB_TARGET:-none}"
fi

echo "==> Sign-out is POST only"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/auth/sign-out")" == "405" ]] \
  && pass "GET /auth/sign-out is rejected" || fail "GET /auth/sign-out is rejected" "expected 405"

echo "==> Document download refuses an unauthenticated caller"
DL_CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  "${BASE}/api/documents/00000000-0000-4000-8d00-000000000001/download")"
if [[ "${DL_CODE}" == "307" || "${DL_CODE}" == "401" || "${DL_CODE}" == "404" ]]; then
  pass "document download is not open to anonymous callers (${DL_CODE})"
else
  fail "document download is not open to anonymous callers" "got ${DL_CODE}"
fi

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
