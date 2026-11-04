#!/usr/bin/env bash
# Deploy an image tag to the production host, with automatic rollback.
#
#   deploy.sh <image-tag>        (on the host, as the `deploy` user; .github/workflows/deploy.yml runs it over SSH)
#
# <image-tag> must match ^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$ (Docker's tag grammar); anything else is rejected
# before any step runs. Steps:
#   1. backup.sh <backup dir>            abort (exit 3, nothing changed) if the backup fails
#   2. record the running tag            -> <app dir>/previous_tag, BEFORE anything changes. Source, in order: the
#                                           image tag of the running api container, <app dir>/current_tag, IMAGE_TAG
#                                           in the env file.
#   3. docker compose pull               images of the new tag (deploy services + migrate)
#   4. docker compose run --rm migrate   the one-shot migration of the NEW tag, before any app container changes
#   5. docker compose up -d --no-deps --wait <services>     (default: api caddy)
#   6. poll the health URL for up to DEPLOY_HEALTH_TIMEOUT (60) seconds
#   7. any failure in 3-6: `up -d --no-deps --wait` with the previous tag, health check again, exit 1 (or 4 if the
#      rollback itself fails). On success <app dir>/current_tag holds the running tag.
# The tag is selected only through the IMAGE_TAG environment variable, which overrides the env file for compose
# interpolation; the env file (secrets) is never edited. Because .env keeps its original IMAGE_TAG, run manual compose
# commands as: IMAGE_TAG="$(cat /opt/tocs/current_tag)" docker compose -p tocs --env-file .env -f compose.prod.yml ...
#
# Rollback and the database schema: migrations are additive-only (new tables / nullable columns / indexes; no drops
# or renames in the same release that stops using something), so the previous app image keeps working against a
# schema migrated by the new tag, and rolling back the app image is safe. If `migrate` fails midway (step 4), no app
# container has been touched yet, so the previous version keeps running against the old (or partially migrated,
# still compatible) schema: rollback is just "keep / restore the previous tag". Rollback never runs the old migrate
# image (--no-deps), and never restores the database: a restore is a separate, manual decision (restore.sh, using
# the backup taken in step 1). Needs the stack (postgres) already running: the very first install is manual (see
# compose.prod.yml). Runs under flock: concurrent deploys are refused.
#
# Environment (defaults are the production layout installed by Ansible into /opt/tocs):
#   DEPLOY_APP_DIR        /opt/tocs (previous_tag, current_tag, .deploy.lock live here)
#   TOCS_ENV_FILE         $DEPLOY_APP_DIR/.env       (must be readable by the deploy user)
#   COMPOSE_FILE          $DEPLOY_APP_DIR/compose.prod.yml (a single file)
#   COMPOSE_PROJECT_NAME  tocs
#   DEPLOY_SERVICES       "api caddy"   services (re)started with the new tag
#   DEPLOY_API_SERVICE    api           service whose running image tag is the "current" tag
#   DEPLOY_MIGRATE_SERVICE migrate
#   DEPLOY_BACKUP_DIR     $DEPLOY_APP_DIR/backups
#   DEPLOY_BACKUP_SCRIPT  <dir of this script>/backup.sh (BACKUP_* settings: see backup.sh, e.g. backup.env)
#   DEPLOY_HEALTH_URL     default https://<SITE_ADDRESS from the env file>/healthz, resolved to 127.0.0.1:443 (curl
#                         --resolve) so the real certificate is verified without depending on hairpin NAT
#   DEPLOY_HEALTH_TIMEOUT 60 (seconds)      DEPLOY_HEALTH_INSECURE  1 = curl -k (tests only)
#   DEPLOY_WAIT_TIMEOUT   180 (seconds for `compose up --wait`)
#   DEPLOY_LOCK_TIMEOUT   0 (seconds to wait for a concurrent deploy; 0 = refuse immediately)
# Never prints secrets: no env file contents, no URLs with credentials.
#
# Exit codes: 0 deployed and healthy; 1 failed, previous tag restored (or nothing was changed); 2 usage / invalid tag
# / configuration error (nothing done); 3 backup failed, deploy aborted (nothing changed); 4 failed AND the rollback
# failed or was impossible (no previous tag): manual intervention needed; 5 another deploy is running.
set -euo pipefail
umask 077

log() { printf '%s deploy: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; }
die() {
  local code=$1
  shift
  log "ERROR: $*"
  exit "$code"
}

TAG_RE='^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$'
[ $# -eq 1 ] || die 2 "usage: deploy.sh <image-tag>"
NEW_TAG=$1
[[ $NEW_TAG =~ $TAG_RE ]] || die 2 "invalid image tag (allowed: letters, digits, '_', '.', '-'; max 128; no leading '.' or '-'); nothing was done"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${DEPLOY_APP_DIR:-/opt/tocs}"
ENV_FILE="${TOCS_ENV_FILE:-$APP_DIR/.env}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/compose.prod.yml}"
PROJECT="${COMPOSE_PROJECT_NAME:-tocs}"
BACKUP_DIR="${DEPLOY_BACKUP_DIR:-$APP_DIR/backups}"
BACKUP_SCRIPT="${DEPLOY_BACKUP_SCRIPT:-$SCRIPT_DIR/backup.sh}"
API_SERVICE="${DEPLOY_API_SERVICE:-api}"
MIGRATE_SERVICE="${DEPLOY_MIGRATE_SERVICE:-migrate}"
HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-60}"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-180}"
LOCK_TIMEOUT="${DEPLOY_LOCK_TIMEOUT:-0}"
read -r -a SERVICES <<<"${DEPLOY_SERVICES:-api caddy}"

for n in "$HEALTH_TIMEOUT" "$WAIT_TIMEOUT" "$LOCK_TIMEOUT"; do
  [[ $n =~ ^[0-9]{1,5}$ ]] || die 2 "DEPLOY_*_TIMEOUT values must be integers (seconds)"
done
[ "${#SERVICES[@]}" -gt 0 ] || die 2 "DEPLOY_SERVICES is empty"
for s in "${SERVICES[@]}" "$API_SERVICE" "$MIGRATE_SERVICE"; do
  [[ $s =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 2 "invalid service name in DEPLOY_SERVICES / DEPLOY_*_SERVICE"
done
for tool in docker curl flock; do
  command -v "$tool" >/dev/null 2>&1 || die 2 "$tool is not installed"
done
[ -d "$APP_DIR" ] || die 2 "app directory not found: $APP_DIR"
[ -f "$COMPOSE_FILE" ] || die 2 "compose file not found: $COMPOSE_FILE"
[ -r "$ENV_FILE" ] || die 2 "env file not readable by $(id -un): $ENV_FILE"
[ -r "$BACKUP_SCRIPT" ] || die 2 "backup script not found: $BACKUP_SCRIPT"

exec 8>"$APP_DIR/.deploy.lock"
if [ "$LOCK_TIMEOUT" -eq 0 ]; then
  flock -n 8 || die 5 "another deploy is running"
else
  flock -w "$LOCK_TIMEOUT" 8 || die 5 "another deploy is running"
fi

compose() { docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

env_value() { # env_value <KEY>: last KEY=value in the env file, quotes stripped (parsed, never sourced)
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 || true)"
  line=${line#*=}
  line=${line%$'\r'}
  if [[ $line =~ ^\"(.*)\"$ || $line =~ ^\'(.*)\'$ ]]; then line=${BASH_REMATCH[1]}; fi
  printf '%s' "$line"
}

write_state() { # write_state <file> <value>: atomic replace
  local tmp
  tmp="$(mktemp "$APP_DIR/.state.XXXXXX")"
  printf '%s\n' "$2" >"$tmp"
  chmod 644 "$tmp"
  mv -f -- "$tmp" "$1"
}

running_tag() { # image tag of the running api container, empty when none
  local id img last
  id="$(compose ps -q "$API_SERVICE" 2>/dev/null | head -n1 || true)"
  [ -n "$id" ] || return 0
  img="$(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null || true)"
  img=${img%%@*}
  last=${img##*/}
  if [[ $last == *:* ]]; then printf '%s' "${last##*:}"; fi
}

# --- health check target
CURL=(curl -fsS -o /dev/null --max-time 5)
if [ "${DEPLOY_HEALTH_INSECURE:-0}" = 1 ]; then CURL+=(-k); fi
if [ -n "${DEPLOY_HEALTH_URL:-}" ]; then
  HEALTH_URL=$DEPLOY_HEALTH_URL
else
  SITE="$(env_value SITE_ADDRESS)"
  SITE=${SITE:-register.to-cs.org}
  [[ $SITE =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,252})$ ]] || die 2 "SITE_ADDRESS in the env file is not a plain host name"
  HEALTH_URL="https://$SITE/healthz"
  CURL+=(--resolve "$SITE:443:127.0.0.1")
fi

healthy() { # poll until healthy or DEPLOY_HEALTH_TIMEOUT
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while :; do
    if "${CURL[@]}" "$HEALTH_URL" 2>/dev/null; then return 0; fi
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 2
  done
}

PREV_TAG=""
rollback() { # rollback <reason>: never returns
  log "FAILED: $1"
  if [ -z "$PREV_TAG" ]; then
    die 4 "no previous tag known: cannot roll back. MANUAL INTERVENTION NEEDED"
  fi
  log "rolling back to previous tag $PREV_TAG"
  export IMAGE_TAG="$PREV_TAG"
  if compose up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" "${SERVICES[@]}" && healthy; then
    write_state "$APP_DIR/current_tag" "$PREV_TAG"
    log "rolled back: $PREV_TAG is running and healthy; deploy of $NEW_TAG failed"
    exit 1
  fi
  die 4 "ROLLBACK TO $PREV_TAG FAILED (containers not healthy). MANUAL INTERVENTION NEEDED"
}

log "deploying $NEW_TAG (project $PROJECT, services: ${SERVICES[*]})"

# 1. backup
log "step 1/6: backup into $BACKUP_DIR"
export COMPOSE_FILE TOCS_ENV_FILE="$ENV_FILE" COMPOSE_PROJECT_NAME="$PROJECT" TOCS_APP_DIR="$APP_DIR"
if ! ARTIFACT="$(bash "$BACKUP_SCRIPT" "$BACKUP_DIR")"; then
  die 3 "backup failed: deploy aborted, nothing was changed"
fi
log "backup written: $ARTIFACT"

# 2. record the running tag before anything changes
PREV_TAG="$(running_tag)"
PREV_SOURCE="running $API_SERVICE container"
if [ -z "$PREV_TAG" ] && [ -s "$APP_DIR/current_tag" ]; then
  PREV_TAG="$(head -n1 "$APP_DIR/current_tag")"
  PREV_SOURCE="current_tag file"
fi
if [ -z "$PREV_TAG" ]; then
  PREV_TAG="$(env_value IMAGE_TAG)"
  PREV_SOURCE="IMAGE_TAG in the env file"
fi
if [ -n "$PREV_TAG" ] && ! [[ $PREV_TAG =~ $TAG_RE ]]; then
  log "WARNING: ignoring an invalid previous tag from the $PREV_SOURCE"
  PREV_TAG=""
fi
if [ -n "$PREV_TAG" ]; then
  write_state "$APP_DIR/previous_tag" "$PREV_TAG"
  log "step 2/6: previous tag $PREV_TAG (from the $PREV_SOURCE) recorded in $APP_DIR/previous_tag"
else
  log "step 2/6: WARNING: no previous tag known; a failure cannot be rolled back automatically"
fi

export IMAGE_TAG="$NEW_TAG"

# 3. pull
log "step 3/6: pulling images for $NEW_TAG"
compose pull --quiet "${SERVICES[@]}" "$MIGRATE_SERVICE" || rollback "pulling images for $NEW_TAG failed"

# 4. migrate (one-shot, new tag, before any app container changes)
log "step 4/6: running $MIGRATE_SERVICE"
compose run --rm -T "$MIGRATE_SERVICE" </dev/null || rollback "$MIGRATE_SERVICE failed (app containers untouched)"

# 5. start the new version
log "step 5/6: starting ${SERVICES[*]} on $NEW_TAG"
compose up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" "${SERVICES[@]}" ||
  rollback "containers for $NEW_TAG did not become healthy"

# 6. health check through the public endpoint
log "step 6/6: waiting up to ${HEALTH_TIMEOUT}s for $HEALTH_URL"
healthy || rollback "health check $HEALTH_URL failed for ${HEALTH_TIMEOUT}s"

write_state "$APP_DIR/current_tag" "$NEW_TAG"
log "deployed $NEW_TAG (previous: ${PREV_TAG:-none})"
