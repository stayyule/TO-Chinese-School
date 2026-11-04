#!/bin/sh
# One-shot schema migration (the `migrate` Compose service; image target `migrate` of deploy/Dockerfile.backend).
# Runs as tocs_migrator (DATABASE_MIGRATOR_URL), in this order (see backend/prisma/migrations/README.md):
#   1. db/prisma-migrations-table.sql : CREATE TABLE IF NOT EXISTS _prisma_migrations. The production database
#      already holds the 29 legacy baseline tables, so without it Prisma refuses (P3005). Idempotent no-op later.
#   2. prisma migrate deploy          : applies pending migrations only (never reset/dev/push).
#   3. db/grants.sql                  : idempotent tocs_app privileges; must follow EVERY deploy.
# Prerequisites (not done here): the roles exist (deploy/db/init-roles.sql: the postgres service runs it on first
# start of an empty volume) and the database already contains the legacy baseline (restored production dump).
# Never prints the connection URL.
set -eu

: "${DATABASE_MIGRATOR_URL:?DATABASE_MIGRATOR_URL is required}"
# schema.prisma also names env("DATABASE_URL"); the migrator does not need the app password, so reuse its own URL.
export DATABASE_URL="${DATABASE_URL:-$DATABASE_MIGRATOR_URL}"
# psql rejects Prisma-only query parameters such as ?schema=public.
PSQL_URL=$(printf '%s' "$DATABASE_MIGRATOR_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')

cd /app
echo "migrate: ensuring _prisma_migrations exists"
psql "$PSQL_URL" -X -q -v ON_ERROR_STOP=1 -f db/prisma-migrations-table.sql
echo "migrate: prisma migrate deploy"
node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
echo "migrate: applying grants"
psql "$PSQL_URL" -X -q -v ON_ERROR_STOP=1 -f db/grants.sql
echo "migrate: done"
