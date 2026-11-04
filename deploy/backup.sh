#!/usr/bin/env bash
# Encrypted logical backup of the TOCS database.
#
#   backup.sh <dest-dir>
#
# Streams `pg_dump -Fc` straight into `age -r <recipient>`; the plaintext dump never touches the disk. The artifact
# is written under a temporary name in <dest-dir> (umask 077) and atomically renamed to
#   <dest-dir>/tocs-<UTC yyyymmddThhmmssZ>-<db>.dump.age      (mode 600)
# next to a `<artifact>.sha256` checksum file (`sha256sum -c` format). A failed pg_dump or age (pipefail) removes the
# temporary file and exits non-zero: no empty or partial artifact is ever left under the final name. On success the
# artifact path is the only line printed on stdout (logs go to stderr).
# Then, in this order: optional upload (BACKUP_REMOTE), then local retention pruning (see below).
#
# Only the age RECIPIENT (public key) is needed here: the host that takes backups cannot read them. Keep the identity
# (private key) offline / in the password manager; restore.sh needs it.
#
# Environment:
#   BACKUP_AGE_RECIPIENT   required, age public key (age1...). Refuses to run when empty.
#   BACKUP_MODE            compose (default) | direct
#     compose: pg_dump runs inside the postgres compose service as its POSTGRES_USER over the local socket:
#       COMPOSE_FILE         default $TOCS_APP_DIR/compose.prod.yml (a single file)
#       COMPOSE_PROJECT_NAME default tocs
#       TOCS_ENV_FILE        default $TOCS_APP_DIR/.env (compose needs it to parse the file)
#       BACKUP_PG_SERVICE    default postgres
#       TOCS_APP_DIR         default /opt/tocs
#     direct: pg_dump on PATH with the standard libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD or PGPASSFILE);
#       PGDATABASE is required. Never prompts for a password (-w).
#   BACKUP_RETENTION_DAYS  default 14 (integer 1..3650). After a successful backup, deletes files in <dest-dir> ONLY
#                          (no recursion, no symlinks) whose name matches tocs-<timestamp>-<db>.dump.age[.sha256]
#                          exactly and whose mtime is older than this many days. The artifact just written and the
#                          newest artifact in the directory are never deleted. Remote copies are not pruned here
#                          (use the storage provider's lifecycle rules).
#   BACKUP_REMOTE          optional rclone destination (e.g. `offsite:tocs-backups`); artifact + checksum are copied
#                          with `rclone copy`. Configure credentials in the rclone config file (RCLONE_CONFIG), not
#                          inline in this value. The value is never printed.
#   BACKUP_VERIFY_IDENTITY_FILE optional age identity: when set, the new artifact is decrypted and checked with
#                          `pg_restore --list` before it is kept (for restore drills; production hosts hold only the
#                          recipient).
#   BACKUP_LOCK_TIMEOUT    seconds to wait for another backup into the same directory (default 600).
#   BACKUP_ENV_FILE        optional KEY=VALUE file (default $TOCS_APP_DIR/backup.env when it exists) supplying
#                          BACKUP_AGE_RECIPIENT, BACKUP_REMOTE, BACKUP_RETENTION_DAYS, RCLONE_CONFIG for variables not
#                          already set in the environment. Parsed, never sourced; other keys are ignored.
#
# Exit codes: 0 ok; 1 dump/encryption/verification failed (nothing kept); 2 usage or configuration error (nothing
# done); 4 artifact written locally but the upload failed (path still printed); 5 another backup holds the lock.
set -euo pipefail
umask 077

log() { printf 'backup: %s\n' "$*" >&2; }
die() {
  local code=$1
  shift
  log "ERROR: $*"
  exit "$code"
}

if [ $# -ne 1 ] || [ -z "$1" ]; then die 2 "usage: backup.sh <dest-dir>"; fi
DEST_ARG=$1

APP_DIR="${TOCS_APP_DIR:-/opt/tocs}"

# Optional non-secret settings file (the deploy user's SSH session and the systemd timer both read it).
ENV_FILE_SETTINGS="${BACKUP_ENV_FILE:-}"
if [ -z "$ENV_FILE_SETTINGS" ] && [ -f "$APP_DIR/backup.env" ]; then ENV_FILE_SETTINGS="$APP_DIR/backup.env"; fi
if [ -n "$ENV_FILE_SETTINGS" ]; then
  [ -r "$ENV_FILE_SETTINGS" ] || die 2 "BACKUP_ENV_FILE is not readable"
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ ^(BACKUP_AGE_RECIPIENT|BACKUP_REMOTE|BACKUP_RETENTION_DAYS|RCLONE_CONFIG)=(.*)$ ]]; then
      key=${BASH_REMATCH[1]}
      value=${BASH_REMATCH[2]}
      value=${value%$'\r'}
      if [[ $value =~ ^\"(.*)\"$ || $value =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
      if [ -z "${!key+x}" ]; then export "$key=$value"; fi
    fi
  done <"$ENV_FILE_SETTINGS"
fi

RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
[ -n "$RECIPIENT" ] || die 2 "BACKUP_AGE_RECIPIENT is empty: refusing to take a backup (it would be unencrypted or unreadable)"
[[ $RECIPIENT =~ ^age1[0-9a-z]{20,}$ ]] || die 2 "BACKUP_AGE_RECIPIENT is not an age public key (age1...)"

RETENTION="${BACKUP_RETENTION_DAYS:-14}"
if ! [[ $RETENTION =~ ^[0-9]{1,4}$ ]] || [ "$((10#$RETENTION))" -lt 1 ] || [ "$((10#$RETENTION))" -gt 3650 ]; then
  die 2 "BACKUP_RETENTION_DAYS must be an integer between 1 and 3650"
fi
RETENTION=$((10#$RETENTION))

MODE="${BACKUP_MODE:-compose}"
for tool in age sha256sum flock find; do
  command -v "$tool" >/dev/null 2>&1 || die 2 "$tool is not installed"
done

case "$MODE" in
  compose)
    command -v docker >/dev/null 2>&1 || die 2 "docker is not installed"
    COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/compose.prod.yml}"
    PROJECT="${COMPOSE_PROJECT_NAME:-tocs}"
    COMPOSE_ENV_FILE="${TOCS_ENV_FILE:-$APP_DIR/.env}"
    PG_SERVICE="${BACKUP_PG_SERVICE:-postgres}"
    [ -f "$COMPOSE_FILE" ] || die 2 "compose file not found: $COMPOSE_FILE"
    [ -r "$COMPOSE_ENV_FILE" ] || die 2 "env file not readable: $COMPOSE_ENV_FILE"
    compose() { docker compose -p "$PROJECT" --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"; }
    DB="$(compose exec -T "$PG_SERVICE" printenv POSTGRES_DB </dev/null)" ||
      die 1 "cannot reach the $PG_SERVICE service of compose project $PROJECT (is the stack running?)"
    # Single quotes: the variables expand inside the container (its own POSTGRES_USER / POSTGRES_DB).
    # shellcheck disable=SC2016
    dump() { compose exec -T "$PG_SERVICE" sh -c 'exec pg_dump -w -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' </dev/null; }
    archive_list() { compose exec -T "$PG_SERVICE" pg_restore --list; }
    ;;
  direct)
    command -v pg_dump >/dev/null 2>&1 || die 2 "pg_dump is not installed"
    DB="${PGDATABASE:-}"
    [ -n "$DB" ] || die 2 "direct mode needs PGDATABASE"
    dump() { pg_dump -w -Fc </dev/null; }
    archive_list() { pg_restore --list; }
    ;;
  *) die 2 "BACKUP_MODE must be compose or direct" ;;
esac
[[ $DB =~ ^[A-Za-z0-9_-]{1,63}$ ]] || die 2 "database name has characters not allowed in an artifact name"

mkdir -p -- "$DEST_ARG" || die 2 "cannot create destination directory"
DEST="$(cd -- "$DEST_ARG" && pwd -P)" || die 2 "cannot enter destination directory"
[ -w "$DEST" ] || die 2 "destination directory is not writable: $DEST"

exec 9>"$DEST/.tocs-backup.lock"
flock -w "${BACKUP_LOCK_TIMEOUT:-600}" 9 || die 5 "another backup into $DEST is still running"

NAME="tocs-$(date -u +%Y%m%dT%H%M%SZ)-${DB}.dump.age"
FINAL="$DEST/$NAME"
if [ -e "$FINAL" ] || [ -e "$FINAL.sha256" ]; then die 1 "$FINAL already exists (two backups in the same second?)"; fi

TMP=""
cleanup() {
  if [ -n "$TMP" ]; then rm -f -- "$TMP" "$TMP.sha256"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM
TMP="$(mktemp "$DEST/.tocs-partial.XXXXXX")"

log "dumping database '$DB' ($MODE mode), encrypting to the configured age recipient"
set +e
dump | age -r "$RECIPIENT" -o "$TMP"
STATUS=("${PIPESTATUS[@]}")
set -e
[ "${STATUS[0]}" -eq 0 ] || die 1 "pg_dump failed (exit ${STATUS[0]}); no artifact written"
[ "${STATUS[1]}" -eq 0 ] || die 1 "age failed (exit ${STATUS[1]}); no artifact written"
[ -s "$TMP" ] || die 1 "encrypted dump is empty; no artifact written"
[ "$(head -c 21 "$TMP")" = "age-encryption.org/v1" ] || die 1 "output is not an age file; no artifact written"

if [ -n "${BACKUP_VERIFY_IDENTITY_FILE:-}" ]; then
  [ -r "$BACKUP_VERIFY_IDENTITY_FILE" ] || die 2 "BACKUP_VERIFY_IDENTITY_FILE is not readable"
  age -d -i "$BACKUP_VERIFY_IDENTITY_FILE" "$TMP" | archive_list >/dev/null ||
    die 1 "verification failed: the artifact does not decrypt to a readable pg_dump archive; nothing kept"
  log "verified: artifact decrypts to a readable pg_dump archive"
fi

HASH="$(sha256sum <"$TMP")"
HASH=${HASH%% *}
printf '%s  %s\n' "$HASH" "$NAME" >"$TMP.sha256"
mv -T -- "$TMP" "$FINAL"
mv -T -- "$TMP.sha256" "$FINAL.sha256"
TMP=""
sync -- "$FINAL" "$FINAL.sha256" 2>/dev/null || true
log "wrote $FINAL ($(stat -c %s "$FINAL") bytes, sha256 $HASH)"

UPLOAD_FAILED=0
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    log "ERROR: BACKUP_REMOTE is set but rclone is not installed"
    UPLOAD_FAILED=1
  elif rclone copy --quiet -- "$FINAL" "$BACKUP_REMOTE" && rclone copy --quiet -- "$FINAL.sha256" "$BACKUP_REMOTE"; then
    log "uploaded artifact and checksum to the configured remote"
  else
    log "ERROR: upload to the configured remote failed (local artifact kept)"
    UPLOAD_FAILED=1
  fi
fi

# --- retention: dest dir only, strict names, regular files only, never the current or the newest artifact.
ARTIFACT_RE='^tocs-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9_-]{1,63}\.dump\.age(\.sha256)?$'
NEWEST="$(find "$DEST" -mindepth 1 -maxdepth 1 -type f -name 'tocs-*.dump.age' -printf '%T@ %f\n' | sort -n | tail -n1)"
NEWEST=${NEWEST#* }
while IFS= read -r -d '' path; do
  base=${path##*/}
  [[ $base =~ $ARTIFACT_RE ]] || continue
  case "$base" in
    "$NAME" | "$NAME.sha256" | "$NEWEST" | "$NEWEST.sha256") continue ;;
  esac
  if rm -f -- "$path"; then log "retention: deleted $base (older than $RETENTION days)"; else log "WARNING: could not delete $base"; fi
done < <(find "$DEST" -mindepth 1 -maxdepth 1 -type f -name 'tocs-*.dump.age*' -mmin "+$((RETENTION * 1440))" -print0)

printf '%s\n' "$FINAL"
if [ "$UPLOAD_FAILED" -ne 0 ]; then exit 4; fi
