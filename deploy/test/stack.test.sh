#!/usr/bin/env bash
# End-to-end check of the production stack (deploy/compose.prod.yml): builds the images, brings the stack up with a
# local-HTTPS Caddy (SITE_ADDRESS=localhost, CADDY_TLS=internal) and a throwaway database, asserts the security
# properties below, then tears everything down (containers, networks, volumes, the locally built test images).
#
#   bash deploy/test/stack.test.sh                (needs docker + compose v2, curl, openssl; run where the engine is)
#
# Environment: STACK_HTTPS_PORT (default 18443), STACK_HTTP_PORT (default 18080), KEEP_IMAGES=1 to keep the images,
# STACK_TRUST_PROXY (default 1, as in production; set "loopback, linklocal, uniquelocal" to prove that Caddy itself
# overwrites a spoofed X-Forwarded-For even when the api would trust every private-network hop).
# The throwaway credentials are random per run, live only in a temp env file, and are never printed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
PROJECT=tocs-stack-test
HTTPS_PORT="${STACK_HTTPS_PORT:-18443}"
HTTP_PORT="${STACK_HTTP_PORT:-18080}"
BASE="https://localhost:${HTTPS_PORT}"
WORK="$(mktemp -d)"
ENV_FILE="$WORK/stack.env"
FAILURES=0
PASSES=0

compose() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$DEPLOY/compose.prod.yml" -f "$HERE/compose.test.yml" "$@"
}

cleanup() {
  local code=$?
  echo "--- teardown"
  if [ -f "$ENV_FILE" ]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    if [ "${KEEP_IMAGES:-0}" != "1" ]; then
      docker image rm -f "$PROJECT/tocs-api:test" "$PROJECT/tocs-api:test-migrate" "$PROJECT/tocs-web:test" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT INT TERM

pass() { PASSES=$((PASSES + 1)); echo "PASS: $1"; }
fail() { FAILURES=$((FAILURES + 1)); echo "FAIL: $1"; }
check() { # check <description> <command...>
  local desc=$1
  shift
  if "$@"; then pass "$desc"; else fail "$desc"; fi
}

not() { ! "$@" >/dev/null 2>&1; }
rand() { openssl rand -hex "$1"; }

# Throwaway secrets (hex: safe inside URLs and PGOPTIONS).
SESSION_SECRET="$(rand 32)"
POSTGRES_PASSWORD="$(rand 16)"
TOCS_MIGRATOR_PASSWORD="$(rand 16)"
TOCS_APP_PASSWORD="$(rand 16)"
umask 077
cat >"$ENV_FILE" <<EOF
GHCR_OWNER=local
IMAGE_TAG=test
SITE_ADDRESS=localhost
CADDY_TLS=internal
HTTP_PORT=127.0.0.1:${HTTP_PORT}
HTTPS_PORT=127.0.0.1:${HTTPS_PORT}
APP_BASE_URL=https://localhost:${HTTPS_PORT}
POSTGRES_USER=postgres
POSTGRES_DB=tocs
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
TOCS_MIGRATOR_PASSWORD=${TOCS_MIGRATOR_PASSWORD}
TOCS_APP_PASSWORD=${TOCS_APP_PASSWORD}
SESSION_SECRET=${SESSION_SECRET}
MAIL_TRANSPORT=memory
SMTP_URL=
TRUST_PROXY=${STACK_TRUST_PROXY:-1}
EOF

echo "--- build + up (project $PROJECT)"
if [ ! -f "$DEPLOY/compose.prod.yml" ] || [ ! -f "$HERE/compose.test.yml" ]; then
  fail "deploy/compose.prod.yml and deploy/test/compose.test.yml exist"
  echo "RESULT: $PASSES passed, $FAILURES failed"
  exit 1
fi
if ! compose up -d --build --wait --wait-timeout 300; then
  fail "stack starts and becomes healthy"
  compose ps -a || true
  compose logs --no-color --tail 80 migrate api caddy || true
  echo "RESULT: $PASSES passed, $FAILURES failed"
  exit 1
fi
pass "stack starts and becomes healthy (migrate completed, api + postgres healthy)"

C=(curl -sk --max-time 15)
hdr() { { grep -i "^$2:" "$1" || true; } | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

# Caddy has no healthcheck of its own: wait (max 60 s) until it answers over TLS (internal CA issuance included).
for _ in $(seq 1 60); do
  if "${C[@]}" -o /dev/null "$BASE/healthz"; then break; fi
  sleep 1
done

# --- /healthz through Caddy
HEALTH_HEADERS="$WORK/health.h"
HEALTH_BODY="$("${C[@]}" -D "$HEALTH_HEADERS" "$BASE/healthz" || true)"
check '/healthz returns {"status":"ok"}' test "$HEALTH_BODY" = '{"status":"ok"}'
check "Strict-Transport-Security present (max-age >= 1 year)" \
  bash -c '[[ "$1" =~ max-age=([0-9]+) ]] && [ "${BASH_REMATCH[1]}" -ge 31536000 ]' _ "$(hdr "$HEALTH_HEADERS" Strict-Transport-Security)"
CSP="$(hdr "$HEALTH_HEADERS" Content-Security-Policy)"
for directive in "default-src 'self'" "script-src 'self'" "connect-src 'self'" "frame-ancestors 'none'" "object-src 'none'"; do
  check "CSP contains $directive" bash -c '[[ "$1" == *"$2"* ]]' _ "$CSP" "$directive"
done
check "CSP script-src has no unsafe-inline/unsafe-eval" bash -c '! [[ "$1" =~ script-src[^\;]*unsafe ]]' _ "$CSP"
check "X-Content-Type-Options: nosniff" test "$(hdr "$HEALTH_HEADERS" X-Content-Type-Options)" = nosniff
check "X-Frame-Options: DENY" test "$(hdr "$HEALTH_HEADERS" X-Frame-Options)" = DENY
check "Referrer-Policy set" test -n "$(hdr "$HEALTH_HEADERS" Referrer-Policy)"
check "no Server header" bash -c '! grep -qi "^server:" "$1"' _ "$HEALTH_HEADERS"
check "no X-Powered-By header" bash -c '! grep -qi "^x-powered-by:" "$1"' _ "$HEALTH_HEADERS"
check "no Via header" bash -c '! grep -qi "^via:" "$1"' _ "$HEALTH_HEADERS"
check "/healthz is not cacheable (Cache-Control: no-store)" bash -c 'grep -qi "^cache-control:.*no-store" "$1"' _ "$HEALTH_HEADERS"

# --- SPA
SPA_HEADERS="$WORK/spa.h"
SPA_BODY="$WORK/spa.html"
SPA_CODE="$("${C[@]}" -D "$SPA_HEADERS" -o "$SPA_BODY" -w '%{http_code}' "$BASE/some/client/route" || true)"
check "client route returns 200" test "$SPA_CODE" = 200
check "client route is text/html" bash -c 'grep -qi "^content-type: text/html" "$1"' _ "$SPA_HEADERS"
check "client route serves the SPA index.html" grep -q '<div id="root"></div>' "$SPA_BODY"
check "index.html is Cache-Control: no-cache" bash -c 'grep -qi "^cache-control: no-cache" "$1"' _ "$SPA_HEADERS"
check "SPA response carries CSP + HSTS" bash -c 'grep -qi "^content-security-policy:" "$1" && grep -qi "^strict-transport-security:" "$1"' _ "$SPA_HEADERS"
ASSET="$(grep -o '/assets/[^"]*\.js' "$SPA_BODY" | head -1 || true)"
check "index.html references a hashed /assets/*.js bundle" test -n "$ASSET"
if [ -n "$ASSET" ]; then
  ASSET_HEADERS="$WORK/asset.h"
  ASSET_CODE="$("${C[@]}" -H 'Accept-Encoding: gzip' -D "$ASSET_HEADERS" -o /dev/null -w '%{http_code}' "$BASE$ASSET" || true)"
  check "hashed asset returns 200" test "$ASSET_CODE" = 200
  check "hashed asset is immutable with a long max-age" bash -c 'grep -qi "^cache-control:.*max-age=31536000.*immutable" "$1"' _ "$ASSET_HEADERS"
  check "hashed asset is compressed" bash -c 'grep -qi "^content-encoding: gzip" "$1"' _ "$ASSET_HEADERS"
fi
MISSING_CODE="$("${C[@]}" -o /dev/null -w '%{http_code}' "$BASE/assets/does-not-exist-0000.js" || true)"
check "missing hashed asset is 404 (no index.html fallback under /assets)" test "$MISSING_CODE" = 404

# --- API surface
OPENAPI_CODE="$("${C[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/v1/openapi.json" || true)"
check "/api/v1/openapi.json is not served in production (404)" test "$OPENAPI_CODE" = 404
HTTP_CODE="$(curl -s --max-time 10 -o /dev/null -w '%{http_code} %{redirect_url}' "http://localhost:${HTTP_PORT}/some/route?x=1" || true)"
check "plain HTTP redirects to HTTPS" bash -c '[[ "$1" =~ ^30[178]\ https://localhost/some/route\?x=1$ ]]' _ "$HTTP_CODE"

CSRF_HEADERS="$WORK/csrf.h"
JAR="$WORK/cookies.txt"
CSRF_CODE="$("${C[@]}" -c "$JAR" -D "$CSRF_HEADERS" -o /dev/null -w '%{http_code}' "$BASE/api/v1/auth/csrf" || true)"
check "GET /api/v1/auth/csrf returns 200" test "$CSRF_CODE" = 200
check "csrf sets tocs_csrf cookie with Secure" bash -c 'grep -i "^set-cookie: tocs_csrf=" "$1" | grep -qi "; *secure"' _ "$CSRF_HEADERS"
check "csrf response carries HSTS" bash -c 'grep -qi "^strict-transport-security:" "$1"' _ "$CSRF_HEADERS"
check "/api responses are Cache-Control: no-store" bash -c 'grep -qi "^cache-control:.*no-store" "$1"' _ "$CSRF_HEADERS"

# --- X-Forwarded-For spoofing: a client-supplied XFF must never become the API's req.ip (audit ip).
PROBE_USER="xff-probe-$(rand 6)"
TOKEN="$(awk '$6 == "tocs_csrf" { print $7 }' "$JAR" | tail -1)"
LOGIN_CODE="$("${C[@]}" -b "$JAR" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $TOKEN" -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 1.2.3.4' \
  --data "{\"username\":\"$PROBE_USER\",\"password\":\"not-the-password\"}" || true)"
check "login through Caddy reaches the API and the DB (401 for an unknown user)" test "$LOGIN_CODE" = 401
AUDIT_IP="$(compose exec -T postgres psql -U postgres -d tocs -Atc \
  "SELECT coalesce(ip, '<null>') FROM audit_logs WHERE actor_username = '$PROBE_USER' ORDER BY id DESC LIMIT 1" 2>/dev/null || true)"
check "audit row recorded for the probe login" test -n "$AUDIT_IP"
check "spoofed X-Forwarded-For is not trusted (audit ip '$AUDIT_IP' != 1.2.3.4)" \
  bash -c '[ -n "$1" ] && [ "$1" != "<null>" ] && [[ "$1" != *1.2.3.4* ]]' _ "$AUDIT_IP"

# --- network exposure
PUBLISHED="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Label "com.docker.compose.service"}} {{.Ports}}')"
PG_PORT="$(compose port postgres 5432 2>/dev/null || true)"
check "postgres publishes no host port (compose port postgres 5432: '${PG_PORT}')" bash -c '[ -z "$1" ] || [ "$1" = ":0" ]' _ "$PG_PORT"
check "only caddy publishes host ports" bash -c 'while read -r svc ports; do if [ "$svc" != caddy ] && [[ "$ports" == *"->"* ]]; then exit 1; fi; done <<<"$1"' _ "$PUBLISHED"
check "nothing listens on a host port other than caddy's" bash -c '[[ "$1" == *"->8443/tcp"* ]] && ! grep -v "^caddy " <<<"$1" | grep -q -- "->"' _ "$PUBLISHED"
check "postgres is on the internal network only" \
  test "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(compose ps -q postgres)")" = "${PROJECT}_internal "
check "internal network has no outbound route (internal: true)" \
  test "$(docker network inspect -f '{{.Internal}}' "${PROJECT}_internal")" = true
check "caddy is on the edge network only" \
  test "$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(compose ps -q caddy)")" = "${PROJECT}_edge "

# --- api container hardening
API_UID="$(compose exec -T api id -u 2>/dev/null | tr -d '\r' || true)"
check "api runs as non-root (uid '$API_UID')" bash -c '[ -n "$1" ] && [ "$1" != 0 ]' _ "$API_UID"
check "api root filesystem is read-only (touch /app/probe fails)" not compose exec -T api touch /app/probe
check "api /tmp is a writable tmpfs" compose exec -T api sh -c 'touch /tmp/probe && rm /tmp/probe && grep -q " /tmp tmpfs " /proc/mounts'
check "api has no effective capabilities (cap_drop ALL)" \
  test "$(compose exec -T api sh -c 'grep CapEff /proc/1/status' | awk '{print $2}' | tr -d '\r')" = 0000000000000000
check "api has no-new-privileges" test "$(compose exec -T api sh -c 'grep NoNewPrivs /proc/1/status' | awk '{print $2}' | tr -d '\r')" = 1
API_ID="$(compose ps -q api)"
check "api container is read_only with cap_drop ALL" \
  test "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}' "$API_ID")" = "true [ALL]"
check "api image has no prisma CLI (production dependencies only)" not compose exec -T api test -e /app/node_modules/prisma/package.json
CADDY_ID="$(compose ps -q caddy)"
check "caddy runs as non-root, read_only, cap_drop ALL" \
  bash -c '[ "$(docker inspect -f "{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}" "$1")" = "true [ALL]" ] && [ "$(docker exec "$1" id -u)" != 0 ]' _ "$CADDY_ID"
check "migrate exited 0" test "$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -aq migrate)")" = 0

# --- secrets never in logs
LOGS="$(compose logs --no-color 2>&1 || true)"
check "logs mention no secret value" bash -c 'for s in "${@:2}"; do [[ "$1" == *"$s"* ]] && exit 1; done; exit 0' _ "$LOGS" \
  "$SESSION_SECRET" "$POSTGRES_PASSWORD" "$TOCS_MIGRATOR_PASSWORD" "$TOCS_APP_PASSWORD"
check "caddy container env holds no database or session secret" \
  bash -c '! docker inspect -f "{{range .Config.Env}}{{println .}}{{end}}" "$1" | grep -Eq "PASSWORD|SECRET|DATABASE_URL"' _ "$CADDY_ID"

echo "RESULT: $PASSES passed, $FAILURES failed"
[ "$FAILURES" -eq 0 ]
