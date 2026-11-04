#!/usr/bin/env bash
# Restore a backup made by backup.sh.
#
#   restore.sh [--force] <artifact.dump.age> <database-url>
#
# <database-url> is postgresql://[user@]host[:port]/dbname[?params]; the database name is REQUIRED (a URL without one
# is refused, so a restore can never silently land in a default database) and the database must already exist.
# Query parameters: only sslmode, sslrootcert, sslcert, sslkey, connect_timeout, application_name (each once, literal
# lower-case keys). Anything else (dbname=, host=, port=, user=, options=, service=, passfile=, password=, ...) is
# refused, because libpq would let it override the database / server named in the URL.
# PASSWORD: preferred is PGPASSWORD or a PGPASSFILE (~/.pgpass, mode 600) in the environment. `user:password@` in the
# URL is accepted but LEAST preferred: the URL is an argument of this script, so the password is visible in `ps` /
# /proc/<pid>/cmdline and in shell history while it runs. This script itself never prints the password and never
# passes it on to child command lines (it is handed to libpq through PGPASSWORD); messages show the URL without it.
#
# Steps: verify <artifact>.sha256 when it exists next to the artifact -> decrypt with the age identity into a private
# temporary directory (mode 700; removed on exit, also on failure) -> check the archive with `pg_restore --list` ->
# count the objects in the target database -> restore with
#   pg_restore --exit-on-error --single-transaction [--clean --if-exists] -d <url> <decrypted dump>
# A failed restore is rolled back as a whole (single transaction): the target is left as it was.
#
# SAFETY: a target database that already contains objects (tables, views, sequences, functions, types, schemas
# other than public) is REFUSED unless --force or RESTORE_FORCE=1 is given. With force, the restore runs with
# --clean --if-exists: every object contained in the backup is dropped and recreated (objects that are not in the
# backup are left alone). --clean is never used without force.
#
# Environment:
#   BACKUP_AGE_IDENTITY_FILE  required, age identity (private key) file. It must NOT live on the production host;
#                             a warning is printed when it is readable by group/others.
#   RESTORE_FORCE             1 = same as --force (default 0).
#   RESTORE_NO_OWNER          1 = add --no-owner --no-privileges (restore into a server without the tocs roles).
#   RESTORE_TMPDIR            where the decrypted dump is staged (default $TMPDIR or /tmp). It holds plaintext
#                             family data while the restore runs: keep it on an encrypted / private disk.
# Needs age, psql and pg_restore (PostgreSQL 16 client) on PATH. On the production host the postgres service has no
# host port: run this script in a throwaway container on the compose `internal` network that has these tools (for
# example an image like deploy/test/Dockerfile.bk-test-runner), with the identity file mounted read-only.
#
# Exit codes: 0 restored; 1 checksum / decryption / archive / connection / restore failure; 2 usage or configuration
# error; 3 refused: target database is not empty and --force was not given.
set -euo pipefail
umask 077

log() { printf 'restore: %s\n' "$*" >&2; }
die() {
  local code=$1
  shift
  log "ERROR: $*"
  exit "$code"
}
usage() { die 2 "usage: restore.sh [--force] <artifact.dump.age> <database-url>"; }

FORCE="${RESTORE_FORCE:-0}"
while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --) shift; break ;;
    -*) usage ;;
    *) break ;;
  esac
done
[ $# -eq 2 ] || usage
ARTIFACT=$1
URL=$2
[ "$FORCE" = 0 ] || [ "$FORCE" = 1 ] || die 2 "RESTORE_FORCE must be 0 or 1"

if [ ! -f "$ARTIFACT" ] || [ ! -r "$ARTIFACT" ]; then die 2 "artifact not found or not readable: $ARTIFACT"; fi
IDENTITY="${BACKUP_AGE_IDENTITY_FILE:-}"
[ -n "$IDENTITY" ] || die 2 "BACKUP_AGE_IDENTITY_FILE is not set"
if [ ! -f "$IDENTITY" ] || [ ! -r "$IDENTITY" ]; then die 2 "BACKUP_AGE_IDENTITY_FILE is not a readable file"; fi
for tool in age psql pg_restore sha256sum; do
  command -v "$tool" >/dev/null 2>&1 || die 2 "$tool is not installed"
done

# --- parse the URL (never echo it: it may carry a password)
URL_RE='^(postgres|postgresql)://(([^@/?#]*)@)?([^@/?#]+)/([^/?#]+)(\?[^#]*)?$'
[[ $URL =~ $URL_RE ]] ||
  die 2 "database URL must be postgresql://[user[:password]@]host[:port]/dbname (database name required); not printing it"
USERINFO=${BASH_REMATCH[3]}
HOSTPORT=${BASH_REMATCH[4]}
DBNAME=${BASH_REMATCH[5]}
QUERY=${BASH_REMATCH[6]}
# Query parameters: libpq lets dbname=, host=, hostaddr=, port=, user=, service=, options=, passfile=, ... in the
# query override the URL's path / authority, so the database actually restored into could differ from the one
# shown. Only a fixed allowlist of transport settings is accepted: lower-case literal keys (no percent-encoding:
# libpq decodes keys, so `%64bname` would be dbname), each at most once, no empty parameters. Rebuilt from the
# checked parameters only.
QUERY_ALLOWED=" sslmode sslrootcert sslcert sslkey connect_timeout application_name "
CLEAN_QUERY=""
SEEN_KEYS=" "
if [ -n "$QUERY" ]; then
  IFS='&' read -r -a PARAMS <<<"${QUERY#\?}"
  [ "${#PARAMS[@]}" -gt 0 ] || die 2 "empty query string in the database URL"
  # read -a drops a trailing empty field; catch `...&` and `?` explicitly
  case "$QUERY" in *'&' | '?') die 2 "empty query parameter in the database URL" ;; esac
  for param in "${PARAMS[@]}"; do
    key=${param%%=*}
    lower=${key,,}
    if [ "$lower" = password ] || [[ $lower == *%* ]]; then
      die 2 "pass the password in PGPASSWORD / PGPASSFILE (or the URL userinfo), never as a query parameter; percent-encoded query keys are refused"
    fi
    if [ -z "$param" ] || [[ $param != *=* ]] || ! [[ $key =~ ^[a-z_]+$ ]] || [[ $QUERY_ALLOWED != *" $key "* ]]; then
      die 2 "database URL query parameter not allowed (allowed: sslmode, sslrootcert, sslcert, sslkey, connect_timeout, application_name; never dbname/host/port/user/options/service/passfile/...)"
    fi
    [[ $SEEN_KEYS != *" $key "* ]] || die 2 "database URL query parameter '$key' given more than once"
    SEEN_KEYS+="$key "
    CLEAN_QUERY+="${CLEAN_QUERY:+&}$param"
  done
fi
url_decode() { # percent-decoding only ('+' stays '+'); backslashes are protected from printf %b
  local s=${1//\\/\\\\}
  printf '%b' "${s//%/\\x}"
}
DB_USER=${USERINFO%%:*}
if [[ $USERINFO == *:* ]]; then
  PGPASSWORD="$(url_decode "${USERINFO#*:}")"
  export PGPASSWORD
fi
CONN="postgresql://${DB_USER:+$DB_USER@}${HOSTPORT}/${DBNAME}${CLEAN_QUERY:+?$CLEAN_QUERY}" # no password
# Shown with user and database name decoded, i.e. as libpq will use them.
SHOWN="postgresql://${DB_USER:+$(url_decode "$DB_USER")@}${HOSTPORT}/$(url_decode "$DBNAME")"

# An identity readable by group/others is a leak waiting to happen: warn (not fatal: restores are often urgent).
ID_MODE="$(stat -c %a "$IDENTITY" 2>/dev/null || echo 0)"
if [ $((8#$ID_MODE & 8#077)) -ne 0 ]; then
  log "WARNING: identity file is accessible by group/others (mode $ID_MODE); chmod 600 it (or keep it on removable / offline media)"
fi

# --- integrity, decryption, archive check (before touching the target)
if [ -f "$ARTIFACT.sha256" ]; then
  EXPECTED="$(head -n1 "$ARTIFACT.sha256")"
  EXPECTED=${EXPECTED%% *}
  ACTUAL="$(sha256sum <"$ARTIFACT")"
  ACTUAL=${ACTUAL%% *}
  [ "$EXPECTED" = "$ACTUAL" ] || die 1 "checksum mismatch for $ARTIFACT (corrupt or tampered); nothing restored"
  log "checksum ok"
else
  log "no $ARTIFACT.sha256 next to the artifact: skipping checksum verification"
fi

STAGE=""
cleanup() {
  if [ -n "$STAGE" ]; then rm -rf -- "$STAGE"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
STAGE="$(mktemp -d "${RESTORE_TMPDIR:-${TMPDIR:-/tmp}}/tocs-restore.XXXXXX")"
DUMP="$STAGE/dump"
age -d -i "$IDENTITY" -o "$DUMP" "$ARTIFACT" || die 1 "decryption failed (wrong identity or corrupt artifact); nothing restored"
pg_restore --list "$DUMP" >"$STAGE/toc" || die 1 "decrypted file is not a readable pg_dump archive; nothing restored"
TOC_ENTRIES="$(grep -vc '^;' "$STAGE/toc" || true)"

# --- target must exist; must be empty unless forced
read -r -d '' COUNT_SQL <<'SQL' || true
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\_toast%' AND n.nspname NOT LIKE 'pg\_temp%')
+ (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema'))
+ (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND t.typtype IN ('e', 'd', 'r', 'm'))
+ (SELECT count(*) FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public') AND nspname NOT LIKE 'pg\_%')
SQL
OBJECTS="$(psql -X -w -At -v ON_ERROR_STOP=1 -d "$CONN" -c "$COUNT_SQL")" ||
  die 1 "cannot connect to $SHOWN (or count its objects); nothing restored"
[[ $OBJECTS =~ ^[0-9]+$ ]] || die 1 "unexpected answer while counting objects in $SHOWN; nothing restored"

OPTS=(--exit-on-error --single-transaction --no-password)
if [ "$OBJECTS" -gt 0 ]; then
  if [ "$FORCE" != 1 ]; then
    die 3 "target database $SHOWN is not empty ($OBJECTS objects); refusing to restore into it. Restore into a new empty database, or re-run with --force (or RESTORE_FORCE=1) to restore with --clean --if-exists, which DROPS and recreates every object contained in the backup."
  fi
fi
if [ "$FORCE" = 1 ]; then
  OPTS+=(--clean --if-exists)
  log "FORCE: restoring $(basename "$ARTIFACT") ($TOC_ENTRIES archive entries) into $SHOWN ($OBJECTS existing objects) with --clean --if-exists: objects contained in the backup are dropped and recreated"
else
  log "restoring $(basename "$ARTIFACT") ($TOC_ENTRIES archive entries) into empty database $SHOWN"
fi
if [ "${RESTORE_NO_OWNER:-0}" = 1 ]; then OPTS+=(--no-owner --no-privileges); fi

pg_restore "${OPTS[@]}" -d "$CONN" "$DUMP" ||
  die 1 "pg_restore failed; it ran in a single transaction, so $SHOWN is unchanged"
log "done: restored into $SHOWN"
