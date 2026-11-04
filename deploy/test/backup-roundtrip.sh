#!/usr/bin/env bash
# Integration test for deploy/backup.sh, deploy/restore.sh and deploy/deploy.sh.
#
#   bash deploy/test/backup-roundtrip.sh        (needs docker + compose v2 on a Linux docker host; CI-runnable)
#
# The harness builds a runner image (deploy/test/Dockerfile.bk-test-runner: postgres 16 client tools, age, rclone,
# docker CLI) and re-runs itself inside it (--network host, docker socket, repository mounted read-only at the same
# path), so the scripts run with the same tools the production host has. Inside, it starts a throwaway stack
# (deploy/test/compose.deploy-test.yml, project tocs-bk-test: postgres + migrate + api) from a local registry
# container, then checks:
#   backup : refuses an empty recipient / bad retention; direct and compose mode produce an age-encrypted, checksummed,
#            mode-600 artifact with no plaintext; a failing pg_dump leaves no artifact; retention prunes only old
#            files matching the artifact pattern in the destination directory; rclone upload (local remote) and
#            upload failure.
#   restore: round trip of rows incl. Chinese, apostrophe and emoji text byte-for-byte; refuses a non-empty target
#            without --force; --force restores over tampered data; URL validation; never prints the password; wrong
#            identity cannot decrypt.
#   deploy : invalid tag rejected before anything runs; happy path v1 -> v2 records previous_tag; failing health URL,
#            unhealthy container, failing migrate and a missing tag all exit non-zero and leave/restore the previous
#            tag; a failing backup aborts the deploy; concurrent deploys are refused.
# Everything created (containers, networks, volumes, test images, temp dirs) is removed on exit. Base images pulled
# by the build (postgres:16.15-bookworm, busybox, registry, docker:cli) are kept, like any docker build cache.
#
# Environment: BK_TEST_PG_PORT (55432), BK_TEST_APP_PORT (55480), BK_TEST_REGISTRY_PORT (55500) host ports bound on
# 127.0.0.1; KEEP_IMAGES=1 keeps the runner image; BK_TEST_SHOW_LOG=1 prints all script output at the end (it
# contains no secrets: that is asserted). Throwaway credentials and age keys live only in a temp dir.
# shellcheck disable=SC2016,SC2317 # single-quoted `bash -c` bodies take positional args; traps/helpers run indirectly
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$DEPLOY/.." && pwd)"
PROJECT=tocs-bk-test
RUNNER_IMAGE=tocs-bk-test/runner:local
REGISTRY_CONTAINER=tocs-bk-test-registry
PG_PORT="${BK_TEST_PG_PORT:-55432}"
APP_PORT="${BK_TEST_APP_PORT:-55480}"
REG_PORT="${BK_TEST_REGISTRY_PORT:-55500}"
REGISTRY="127.0.0.1:${REG_PORT}"
APP_IMAGE="${REGISTRY}/tocs-bk-test-app"

# Removes every docker object this test can create (idempotent; used inside and, as a safety net, outside).
remove_test_objects() {
  local label="label=com.docker.compose.project=$PROJECT"
  { docker ps -aq --filter "$label" | xargs -r docker rm -f; } >/dev/null 2>&1 || true
  docker rm -f "$REGISTRY_CONTAINER" >/dev/null 2>&1 || true
  { docker network ls -q --filter "$label" | xargs -r docker network rm; } >/dev/null 2>&1 || true
  { docker volume ls -q --filter "$label" | xargs -r docker volume rm; } >/dev/null 2>&1 || true
  { docker images --format '{{.Repository}}:{{.Tag}}' | grep -F "${APP_IMAGE}:" | xargs -r docker image rm -f; } >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------- outer: build the runner and re-run inside it
if [ "${BK_TEST_INSIDE:-0}" != 1 ]; then
  outer_cleanup() {
    local code=$?
    remove_test_objects
    if [ "${KEEP_IMAGES:-0}" != 1 ]; then docker image rm -f "$RUNNER_IMAGE" >/dev/null 2>&1 || true; fi
    exit "$code"
  }
  trap outer_cleanup EXIT INT TERM
  echo "--- building runner image $RUNNER_IMAGE"
  docker build -q -t "$RUNNER_IMAGE" - <"$HERE/Dockerfile.bk-test-runner" >/dev/null
  rc=0
  docker run --rm --network host \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$REPO:$REPO:ro" -w "$REPO" \
    -e BK_TEST_INSIDE=1 -e BK_TEST_SHOW_LOG="${BK_TEST_SHOW_LOG:-0}" -e BK_TEST_PG_PORT="$PG_PORT" -e BK_TEST_APP_PORT="$APP_PORT" -e BK_TEST_REGISTRY_PORT="$REG_PORT" \
    "$RUNNER_IMAGE" bash "$HERE/backup-roundtrip.sh" || rc=$?
  exit "$rc"
fi

# ---------------------------------------------------------------- inner: the actual test
WORK="$(mktemp -d)"
chmod 700 "$WORK"
ENV_FILE="$WORK/stack.env"
LOG="$WORK/all-output.log" # every script output, scanned for secrets at the end
FAILURES=0
PASSES=0
LOCK_HOLDER=""
URLN=0
TAGN=0

cleanup() {
  local code=$?
  echo "--- teardown"
  [ -z "$LOCK_HOLDER" ] || kill "$LOCK_HOLDER" >/dev/null 2>&1 || true
  remove_test_objects
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
finish() {
  if [ "${BK_TEST_SHOW_LOG:-0}" = 1 ] && [ -f "$LOG" ]; then echo "--- script output"; cat "$LOG"; fi
  echo "RESULT: $PASSES passed, $FAILURES failed"
  [ "$FAILURES" -eq 0 ]
  exit $?
}
randhex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# run <outfile> <command...>: runs a script, stdout -> outfile, stderr -> outfile.err; both appended to $LOG.
# Sets RC (never aborts the test).
run() {
  local out=$1
  shift
  RC=0
  "$@" >"$out" 2>"$out.err" || RC=$?
  # The command line itself is not logged: it carries test secrets (env assignments, URLs) by design.
  { echo "### exit $RC"; cat "$out" "$out.err"; } >>"$LOG"
}

echo "--- preconditions"
for s in backup.sh restore.sh deploy.sh; do
  check "deploy/$s exists" test -f "$DEPLOY/$s"
done
check "deploy/test/compose.deploy-test.yml exists" test -f "$HERE/compose.deploy-test.yml"
if [ "$FAILURES" -gt 0 ]; then finish; fi

for t in age age-keygen rclone pg_dump pg_restore psql curl flock sha256sum docker; do
  command -v "$t" >/dev/null || { fail "runner has $t"; }
done
if [ "$FAILURES" -gt 0 ]; then finish; fi

# ---------------------------------------------------------------- setup: keys, secrets, registry, images, stack
umask 077
mkdir -p "$WORK/keys"
age-keygen -o "$WORK/keys/id.txt" 2>/dev/null
age-keygen -o "$WORK/keys/wrong.txt" 2>/dev/null
RECIPIENT="$(age-keygen -y "$WORK/keys/id.txt")"
PGPW="$(randhex 16)"
export PGCLIENTENCODING=UTF8

cat >"$ENV_FILE" <<EOF
REGISTRY=${REGISTRY}
IMAGE_TAG=v1
POSTGRES_PASSWORD=${PGPW}
PG_PORT=${PG_PORT}
APP_PORT=${APP_PORT}
SITE_ADDRESS=localhost
EOF

compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$HERE/compose.deploy-test.yml" "$@"; }

remove_test_objects # leftovers of an interrupted earlier run
echo "--- starting registry and building test images"
docker run -d -q --name "$REGISTRY_CONTAINER" -p "127.0.0.1:${REG_PORT}:5000" registry:2.8.3 >/dev/null
for _ in $(seq 1 30); do curl -fsS -o /dev/null "http://${REGISTRY}/v2/" && break; sleep 1; done
build_tag() { # build_tag <tag> <build-args...>: pushes <tag> and <tag>-migrate, removes the local copies
  local tag=$1
  shift
  if ! docker build -q -t "${APP_IMAGE}:${tag}" --build-arg "VERSION=${tag}" "$@" - <"$HERE/Dockerfile.bk-test-app" \
    >"$WORK/build.log" 2>&1; then
    cat "$WORK/build.log"
    return 1
  fi
  docker tag "${APP_IMAGE}:${tag}" "${APP_IMAGE}:${tag}-migrate"
  docker push -q "${APP_IMAGE}:${tag}" >/dev/null
  docker push -q "${APP_IMAGE}:${tag}-migrate" >/dev/null
  docker image rm "${APP_IMAGE}:${tag}" "${APP_IMAGE}:${tag}-migrate" >/dev/null
}
build_tag v1
build_tag v2
build_tag v3 --build-arg HEALTHZ=0      # health URL fails, container healthy
build_tag v4 --build-arg MIGRATE_EXIT=1 # migrate fails
build_tag v5 --build-arg ALIVE=0        # container healthcheck fails (compose up --wait fails)
# v9 is never pushed: pulling it fails.

echo "--- starting test stack (IMAGE_TAG=v1)"
if ! compose up -d --wait --wait-timeout 120 >"$WORK/up.log" 2>&1; then
  cat "$WORK/up.log"
  fail "test stack starts"
  finish
fi
pass "test stack starts (v1)"

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PG_PORT" -U postgres)
export PGPASSWORD="$PGPW"
sql() { "${PSQL[@]}" -d "$1" -At -c "$2"; }
URL_BASE="postgresql://postgres:${PGPW}@127.0.0.1:${PG_PORT}"

# Seed: Chinese, apostrophe, emoji, multi-line text.
"${PSQL[@]}" -d tocs <<'SQL'
CREATE TABLE bk_students (id integer PRIMARY KEY, name text NOT NULL);
INSERT INTO bk_students VALUES
  (1, '陈小明'),
  (2, 'O''Brien'),
  (3, 'emoji 🎉 家长'),
  (4, E'line one\nline two');
SQL
ROWS_SQL="SELECT string_agg(id || ':' || encode(convert_to(name, 'UTF8'), 'hex'), ',' ORDER BY id) FROM bk_students"
EXPECTED="$(sql tocs "$ROWS_SQL")"
CHEN_HEX="$(printf '%s' '陈小明' | od -An -tx1 | tr -d ' \n')"
check "seed rows contain 陈小明 as UTF-8 bytes $CHEN_HEX" bash -c '[[ "$1" == *"1:$2,"* ]]' _ "$EXPECTED" "$CHEN_HEX"

# Common environment for backups.
DIRECT_ENV=(BACKUP_MODE=direct PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=postgres PGPASSWORD="$PGPW" PGDATABASE=tocs
  BACKUP_AGE_RECIPIENT="$RECIPIENT")
COMPOSE_ENV=(BACKUP_MODE=compose COMPOSE_FILE="$HERE/compose.deploy-test.yml" COMPOSE_PROJECT_NAME="$PROJECT"
  TOCS_ENV_FILE="$ENV_FILE" BACKUP_AGE_RECIPIENT="$RECIPIENT")
ARTIFACT_RE='^tocs-[0-9]{8}T[0-9]{6}Z-tocs\.dump\.age$'
matching_files() { find "$1" -mindepth 1 -maxdepth 1 -name 'tocs-*' | wc -l; }
leftovers() { find "$1" -mindepth 1 -maxdepth 1 ! -name '.tocs-backup.lock' | wc -l; }
no_plaintext() { # no_plaintext <file>: none of the known plaintext strings occur in the file
  ! grep -aqF -e '陈小明' -e 'bk_students' -e 'PGDMP' -e "O'Brien" "$1"
}

echo "--- backup: refusals"
D="$WORK/b-refuse"
mkdir -p "$D"
run "$WORK/o" env "${DIRECT_ENV[@]}" BACKUP_AGE_RECIPIENT= bash "$DEPLOY/backup.sh" "$D"
check "backup refuses an empty BACKUP_AGE_RECIPIENT (exit $RC)" test "$RC" -ne 0
check "  ... and writes no artifact" test "$(matching_files "$D")" -eq 0
check "  ... and says why" grep -q 'BACKUP_AGE_RECIPIENT' "$WORK/o.err"
for bad in 0 -1 abc 14x; do
  run "$WORK/o" env "${DIRECT_ENV[@]}" BACKUP_RETENTION_DAYS="$bad" bash "$DEPLOY/backup.sh" "$D"
  check "backup refuses BACKUP_RETENTION_DAYS=$bad (exit $RC) without writing anything" \
    bash -c '[ "$1" -ne 0 ] && [ "$2" -eq 0 ]' _ "$RC" "$(matching_files "$D")"
done
run "$WORK/o" env "${DIRECT_ENV[@]}" bash "$DEPLOY/backup.sh"
check "backup without a destination argument is a usage error (exit $RC)" test "$RC" -eq 2

echo "--- backup: direct mode"
D="$WORK/b-direct"
mkdir -p "$D"
run "$WORK/o" env "${DIRECT_ENV[@]}" BACKUP_VERIFY_IDENTITY_FILE="$WORK/keys/id.txt" bash "$DEPLOY/backup.sh" "$D"
check "direct-mode backup exits 0 (exit $RC)" test "$RC" -eq 0
A1="$(tail -n1 "$WORK/o")"
check "backup prints the artifact path ($A1)" test -f "$A1"
check "artifact is in the destination directory" test "$(dirname "$A1")" = "$D"
check "artifact name matches tocs-<UTC timestamp>-<db>.dump.age" bash -c '[[ "$(basename "$1")" =~ $2 ]]' _ "$A1" "$ARTIFACT_RE"
check "artifact is mode 600" test "$(stat -c %a "$A1" 2>/dev/null)" = 600
check "artifact is non-empty and age-encrypted (header)" bash -c '[ -s "$1" ] && [ "$(head -c 21 "$1")" = "age-encryption.org/v1" ]' _ "$A1"
check "checksum file verifies (sha256sum -c)" bash -c 'cd "$(dirname "$1")" && sha256sum -c --quiet "$(basename "$1").sha256"' _ "$A1"
check "artifact contains no plaintext marker (陈小明, table name, PGDMP)" no_plaintext "$A1"
check "only the artifact and its checksum remain (no temp / unencrypted files)" test "$(leftovers "$D")" -eq 2
check "artifact cannot be decrypted with a wrong identity" bash -c '! age -d -i "$1" "$2" >/dev/null 2>&1' _ "$WORK/keys/wrong.txt" "$A1"
check "artifact cannot be decrypted without an identity" bash -c '! age -d "$1" >/dev/null 2>&1 </dev/null' _ "$A1"
check "artifact decrypts with the right identity to a pg_dump archive listing bk_students" \
  bash -c 'age -d -i "$1" "$2" | pg_restore --list | grep -q "TABLE public bk_students"' _ "$WORK/keys/id.txt" "$A1"

echo "--- backup: compose mode (pg_dump inside the postgres service)"
D="$WORK/b-compose"
mkdir -p "$D"
run "$WORK/o" env "${COMPOSE_ENV[@]}" bash "$DEPLOY/backup.sh" "$D"
check "compose-mode backup exits 0 (exit $RC)" test "$RC" -eq 0
A2="$(tail -n1 "$WORK/o")"
check "compose-mode artifact exists with the expected name" bash -c '[ -f "$1" ] && [[ "$(basename "$1")" =~ $2 ]]' _ "$A2" "$ARTIFACT_RE"
check "compose-mode artifact has no plaintext and decrypts to a valid archive" \
  bash -c '! grep -aqF "陈小明" "$2" && age -d -i "$1" "$2" | pg_restore --list | grep -q "TABLE public bk_students"' _ "$WORK/keys/id.txt" "$A2"

echo "--- backup: failing pg_dump leaves nothing behind"
for variant in "PGPASSWORD=wrong-password" "PGDATABASE=no_such_db"; do
  D="$WORK/b-fail-${variant%%=*}"
  mkdir -p "$D"
  run "$WORK/o" env "${DIRECT_ENV[@]}" "$variant" bash "$DEPLOY/backup.sh" "$D"
  check "backup with $variant exits non-zero (exit $RC)" test "$RC" -ne 0
  check "  ... prints no artifact path" test ! -s "$WORK/o"
  check "  ... leaves no artifact, checksum or temp file" test "$(leftovers "$D")" -eq 0
done
D="$WORK/b-fail-compose"
mkdir -p "$D"
run "$WORK/o" env "${COMPOSE_ENV[@]}" COMPOSE_PROJECT_NAME=tocs-bk-test-absent bash "$DEPLOY/backup.sh" "$D"
check "compose-mode backup against a stack that is not running exits non-zero and leaves nothing (exit $RC)" \
  bash -c '[ "$1" -ne 0 ] && [ "$2" -eq 0 ]' _ "$RC" "$(leftovers "$D")"

echo "--- backup: retention"
D="$WORK/b-retention"
mkdir -p "$D/sub"
OLD="$D/tocs-20200101T000000Z-tocs.dump.age"
RECENT="$D/tocs-20200102T000000Z-tocs.dump.age"
touch -d '20 days ago' "$OLD" "$OLD.sha256" "$D/notes-old.txt" "$D/tocs-manual-copy.dump.age" "$D/sub/tocs-20200101T000000Z-tocs.dump.age"
touch -d '5 days ago' "$RECENT" "$RECENT.sha256"
ln -s "$OLD" "$D/tocs-20200103T000000Z-tocs.dump.age"
touch -h -d '20 days ago' "$D/tocs-20200103T000000Z-tocs.dump.age"
run "$WORK/o" env "${DIRECT_ENV[@]}" bash "$DEPLOY/backup.sh" "$D"
check "backup with retention exits 0 (exit $RC)" test "$RC" -eq 0
A3="$(tail -n1 "$WORK/o")"
check "retention: old matching artifact deleted" test ! -e "$OLD"
check "retention: old matching checksum deleted" test ! -e "$OLD.sha256"
check "retention: recent (5 days) artifact kept" test -f "$RECENT"
check "retention: recent checksum kept" test -f "$RECENT.sha256"
check "retention: new artifact kept" test -f "$A3"
check "retention: old non-matching file kept" test -f "$D/notes-old.txt"
check "retention: old file not matching the strict name pattern kept" test -f "$D/tocs-manual-copy.dump.age"
check "retention: old matching file in a subdirectory kept (not recursive)" test -f "$D/sub/tocs-20200101T000000Z-tocs.dump.age"
check "retention: symlink not followed or deleted" test -L "$D/tocs-20200103T000000Z-tocs.dump.age"
D="$WORK/b-retention-default"
mkdir -p "$D"
touch -d '13 days ago' "$D/tocs-20200104T000000Z-tocs.dump.age"
touch -d '15 days ago' "$D/tocs-20200105T000000Z-tocs.dump.age"
run "$WORK/o" env "${DIRECT_ENV[@]}" bash "$DEPLOY/backup.sh" "$D"
check "default retention (14 days): 13-day-old kept, 15-day-old deleted" \
  bash -c '[ -f "$1/tocs-20200104T000000Z-tocs.dump.age" ] && [ ! -e "$1/tocs-20200105T000000Z-tocs.dump.age" ]' _ "$D"

echo "--- backup: rclone upload"
D="$WORK/b-upload"
mkdir -p "$D" "$WORK/remote"
run "$WORK/o" env "${DIRECT_ENV[@]}" BACKUP_REMOTE=":local:$WORK/remote/tocs" RCLONE_CONFIG=/dev/null bash "$DEPLOY/backup.sh" "$D"
check "backup with BACKUP_REMOTE exits 0 (exit $RC)" test "$RC" -eq 0
A4="$(tail -n1 "$WORK/o")"
check "uploaded artifact is identical to the local one" cmp -s "$A4" "$WORK/remote/tocs/$(basename "$A4")"
check "checksum uploaded too" test -f "$WORK/remote/tocs/$(basename "$A4").sha256"
D="$WORK/b-upload-fail"
mkdir -p "$D"
run "$WORK/o" env "${DIRECT_ENV[@]}" BACKUP_REMOTE="nosuchremote:bucket" RCLONE_CONFIG=/dev/null bash "$DEPLOY/backup.sh" "$D"
check "upload failure exits 4 (exit $RC)" test "$RC" -eq 4
check "  ... but keeps (and prints) the local artifact" test -f "$(tail -n1 "$WORK/o")"

echo "--- restore"
RESTORE_ENV=(BACKUP_AGE_IDENTITY_FILE="$WORK/keys/id.txt" PGPASSWORD=)
run "$WORK/o" env "${RESTORE_ENV[@]}" bash "$DEPLOY/restore.sh" "$A1" "$URL_BASE/tocs"
check "restore into the non-empty source database without --force is refused (exit $RC)" test "$RC" -eq 3
check "  ... explains the refusal and how to override" grep -q -- '--force' "$WORK/o.err"
check "  ... data untouched" test "$(sql tocs "$ROWS_SQL")" = "$EXPECTED"

for bad in "$URL_BASE" "$URL_BASE/" "mysql://postgres:${PGPW}@127.0.0.1:${PG_PORT}/tocs" \
  "postgresql://127.0.0.1:${PG_PORT}/tocs?password=${PGPW}" "not a url"; do
  run "$WORK/o" env "${RESTORE_ENV[@]}" bash "$DEPLOY/restore.sh" --force "$A1" "$bad"
  check "restore rejects database URL #$((++URLN)) (no db name / wrong scheme / password in query) (exit $RC)" test "$RC" -eq 2
done
run "$WORK/o" env BACKUP_AGE_IDENTITY_FILE="$WORK/keys/wrong.txt" bash "$DEPLOY/restore.sh" "$A1" "$URL_BASE/tocs_none"
check "restore with a wrong identity fails (exit $RC)" test "$RC" -ne 0
run "$WORK/o" env BACKUP_AGE_IDENTITY_FILE= bash "$DEPLOY/restore.sh" "$A1" "$URL_BASE/tocs_none"
check "restore without BACKUP_AGE_IDENTITY_FILE fails (exit $RC)" test "$RC" -eq 2
cp "$A1" "$WORK/tampered.dump.age"
cp "$A1.sha256" "$WORK/tampered.dump.age.sha256"
printf 'x' >>"$WORK/tampered.dump.age"
run "$WORK/o" env "${RESTORE_ENV[@]}" bash "$DEPLOY/restore.sh" "$WORK/tampered.dump.age" "$URL_BASE/tocs_none"
check "restore refuses an artifact whose checksum does not match (exit $RC)" test "$RC" -ne 0

sql postgres "CREATE DATABASE tocs_restore" >/dev/null
run "$WORK/o" env "${RESTORE_ENV[@]}" bash "$DEPLOY/restore.sh" "$A1" "$URL_BASE/tocs_restore"
check "restore into a fresh empty database exits 0 (exit $RC)" test "$RC" -eq 0
check "restored rows (incl. 陈小明, apostrophe, emoji, newline) are byte-for-byte identical" \
  test "$(sql tocs_restore "$ROWS_SQL" 2>/dev/null)" = "$EXPECTED"
check "restored 陈小明 reads back as text" test "$(sql tocs_restore "SELECT name FROM bk_students WHERE id = 1" 2>/dev/null)" = '陈小明'

run "$WORK/o" env "${RESTORE_ENV[@]}" RESTORE_FORCE=1 bash "$DEPLOY/restore.sh" "$A2" "$URL_BASE/tocs_restore"
check "RESTORE_FORCE=1 restores the compose-mode artifact over a non-empty database (exit $RC)" \
  bash -c '[ "$1" -eq 0 ] && [ "$2" = "$3" ]' _ "$RC" "$(sql tocs_restore "$ROWS_SQL" 2>/dev/null)" "$EXPECTED"

sql tocs "DROP TABLE bk_students" >/dev/null
run "$WORK/o" env "${RESTORE_ENV[@]}" bash "$DEPLOY/restore.sh" "$A1" "$URL_BASE/tocs"
check "after DROP TABLE, restore into the (now empty) source database exits 0 (exit $RC)" test "$RC" -eq 0
check "  ... rows are back byte-for-byte" test "$(sql tocs "$ROWS_SQL" 2>/dev/null)" = "$EXPECTED"

sql tocs "UPDATE bk_students SET name = 'tampered' WHERE id = 1; DELETE FROM bk_students WHERE id = 3" >/dev/null
run "$WORK/o" env "${RESTORE_ENV[@]}" bash "$DEPLOY/restore.sh" --force "$A1" "$URL_BASE/tocs"
check "--force restore over tampered data exits 0 (exit $RC)" test "$RC" -eq 0
check "  ... states that it will --clean --if-exists" grep -q -- '--clean --if-exists' "$WORK/o.err"
check "  ... rows are back byte-for-byte" test "$(sql tocs "$ROWS_SQL" 2>/dev/null)" = "$EXPECTED"

echo "--- deploy"
APP="$WORK/app"
mkdir -p "$APP"
DEPLOY_ENV=(COMPOSE_FILE="$HERE/compose.deploy-test.yml" COMPOSE_PROJECT_NAME="$PROJECT" TOCS_ENV_FILE="$ENV_FILE"
  DEPLOY_APP_DIR="$APP" DEPLOY_SERVICES=api DEPLOY_HEALTH_URL="http://127.0.0.1:${APP_PORT}/healthz"
  DEPLOY_HEALTH_TIMEOUT=10 DEPLOY_WAIT_TIMEOUT=60 BACKUP_AGE_RECIPIENT="$RECIPIENT" PGPASSWORD=)
api_tag() { local img; img="$(docker inspect -f '{{.Config.Image}}' "$(compose ps -q api)" 2>/dev/null)" && echo "${img##*:}"; }
api_id() { compose ps -q api; }
served() { curl -fsS --max-time 5 "http://127.0.0.1:${APP_PORT}/version" 2>/dev/null; }
backups() { find "$APP/backups" -maxdepth 1 -name 'tocs-*.dump.age' 2>/dev/null | wc -l; }

check "stack runs v1 before the first deploy" test "$(api_tag)" = v1
for bad in 'v1; rm -rf /' '$(id)' '../v1' '' "v1
v2" '-v1' "$(printf 'a%.0s' $(seq 1 129))"; do
  run "$WORK/o" env "${DEPLOY_ENV[@]}" bash "$DEPLOY/deploy.sh" "$bad"
  check "deploy rejects invalid tag #$((++TAGN)) (exit $RC)" test "$RC" -eq 2
done
check "  ... before anything ran: no backup taken, no previous_tag written, still v1" \
  bash -c '[ "$1" -eq 0 ] && [ ! -e "$2/previous_tag" ] && [ "$3" = v1 ]' _ "$(backups)" "$APP" "$(api_tag)"
run "$WORK/o" env "${DEPLOY_ENV[@]}" bash "$DEPLOY/deploy.sh" v2 extra
check "deploy with two arguments is a usage error (exit $RC)" test "$RC" -eq 2

run "$WORK/o" env "${DEPLOY_ENV[@]}" bash "$DEPLOY/deploy.sh" v2
check "happy path v1 -> v2 exits 0 (exit $RC)" test "$RC" -eq 0
[ "$RC" -eq 0 ] || cat "$WORK/o.err"
check "  ... previous_tag records v1" test "$(cat "$APP/previous_tag" 2>/dev/null)" = v1
check "  ... current_tag records v2" test "$(cat "$APP/current_tag" 2>/dev/null)" = v2
check "  ... api runs image tag v2 (docker inspect)" test "$(api_tag)" = v2
check "  ... v2 is served" test "$(served)" = v2
check "  ... a backup was taken first" test "$(backups)" -eq 1

expect_rollback() { # expect_rollback <label> <expected-exit> <tag> [env overrides...]
  local label=$1 want=$2 tag=$3
  shift 3
  run "$WORK/o" env "${DEPLOY_ENV[@]}" "$@" bash "$DEPLOY/deploy.sh" "$tag"
  check "$label: deploy $tag exits $want (exit $RC)" test "$RC" -eq "$want"
  check "$label: api back on/kept at v2 (got $(api_tag))" test "$(api_tag)" = v2
  check "$label: v2 still served" test "$(served)" = v2
  check "$label: current_tag still v2" test "$(cat "$APP/current_tag" 2>/dev/null)" = v2
}
expect_rollback "failing health URL" 1 v3
check "failing health URL: previous_tag recorded v2 before the attempt" test "$(cat "$APP/previous_tag")" = v2
check "failing health URL: log says it rolled back" grep -qi 'rolled back' "$WORK/o.err"
expect_rollback "unhealthy container (up --wait fails)" 1 v5
ID_BEFORE="$(api_id)"
expect_rollback "failing migrate" 1 v4
check "failing migrate: api container was never replaced" test "$(api_id)" = "$ID_BEFORE"
expect_rollback "missing image tag (pull fails)" 1 v9
check "missing image tag: api container was never replaced" test "$(api_id)" = "$ID_BEFORE"

PREV_SUM="$(sha256sum "$APP/previous_tag")"
N_BACKUPS="$(backups)"
expect_rollback "backup failure" 3 v1 BACKUP_AGE_RECIPIENT=
check "backup failure: previous_tag untouched" test "$(sha256sum "$APP/previous_tag")" = "$PREV_SUM"
check "backup failure: no new backup" test "$(backups)" -eq "$N_BACKUPS"
check "backup failure: log says the deploy was aborted" grep -qi 'abort' "$WORK/o.err"

flock -o "$APP/.deploy.lock" sleep 60 & # -o: the lock dies with this flock process, not with its sleep child
LOCK_HOLDER=$!
sleep 1
expect_rollback "concurrent deploy" 5 v1 DEPLOY_LOCK_TIMEOUT=1
kill "$LOCK_HOLDER" >/dev/null 2>&1 || true
LOCK_HOLDER=""

run "$WORK/o" env "${DEPLOY_ENV[@]}" bash "$DEPLOY/deploy.sh" v1
check "deploying back to v1 (a normal forward deploy) exits 0 and runs v1 (exit $RC)" \
  bash -c '[ "$1" -eq 0 ] && [ "$2" = v1 ] && [ "$3" = v2 ]' _ "$RC" "$(api_tag)" "$(cat "$APP/previous_tag")"

echo "--- secrets"
check "no script output contains the database password" bash -c '! grep -qF "$1" "$2"' _ "$PGPW" "$LOG"
check "no script output contains the age identity" bash -c '! grep -qF "$(grep AGE-SECRET-KEY "$1")" "$2"' _ "$WORK/keys/id.txt" "$LOG"

finish
