# Migrations

There is deliberately **no `0_init` migration**. The 29 baseline tables already exist in the
production database (created by the legacy Rails app), so Prisma migrations here are
**additive only** on top of them: `*_foundation` adds `sessions`, `auth_tokens`, `permissions`,
`role_permissions`, `audit_logs` and `users.password_hash_v2`; `*_auth_indexes` adds the indexes the auth hot
paths need (login-failure counts and phone-check limits on `audit_logs`, `sessions.user_id`, and
`auth_tokens (person_id, purpose, used_at)`). Never recreate, drop, rename or
truncate baseline objects (`node scripts/check-migrations.mjs backend/prisma/migrations` enforces this).

`backend/db/baseline.sql` is only a stand-in for production when building dev/test databases.

## Accounts

- `tocs_migrator` (`DATABASE_MIGRATOR_URL`) runs `prisma migrate deploy` (schema `directUrl`).
- `tocs_app` (`DATABASE_URL`) is what the running app and PrismaClient use; DML only.

## Dev (`tocs_dev`)

1. Start `deploy/compose.dev.yml` (creates `tocs_dev` and both roles via `deploy/db/init-roles.sql`).
2. As superuser load `backend/db/baseline.sql`, then re-run `deploy/db/init-roles.sql` (transfers table ownership to `tocs_migrator`).
3. As `tocs_migrator` run `deploy/db/prisma-migrations-table.sql` (once), then `npx prisma migrate deploy` in `backend/`.
4. As `tocs_migrator` run `deploy/db/grants.sql` (after every deploy; idempotent).

## Production

The database already has the baseline: run steps 3 and 4 only (step 3's SQL pre-creates an empty
`_prisma_migrations` so Prisma does not refuse with P3005 on a non-empty database; `migrate deploy`
then applies only the foundation migration and later ones, currently `*_auth_indexes`). Roles come from `init-roles.sql` run by a DBA
with production passwords supplied via `PGOPTIONS="-c tocs.migrator_password=... -c tocs.app_password=..."`.

With `deploy/compose.prod.yml`, the one-shot `migrate` service (`deploy/migrate.sh`, image
`tocs-api:<tag>-migrate`) runs steps 3 and 4 on every `up` before the api starts (step 3's SQL is
`CREATE TABLE IF NOT EXISTS`, so re-running it is a no-op). The `postgres` service runs `init-roles.sql` on first start
of an empty volume; the legacy baseline (production dump) must be restored into that volume before the first `up`,
otherwise the foundation migration fails and the api never starts. The api itself never migrates.

## Integration tests

`backend/test/global-setup.ts` builds `tocs_test` as baseline.sql + every migration.sql in order
+ init-roles.sql + grants.sql.

Only ever use `migrate reset`, `db push` or `migrate dev` against `tocs_dev` / `tocs_test`.

## Passwords and safety notes

- `init-roles.sql` fails closed: unless `tocs.migrator_password` / `tocs.app_password` are supplied
  (`PGOPTIONS`), creating a role raises an error. Dev compose and the tests opt in to the dev defaults with
  `-c tocs.allow_dev_passwords=on`. Re-running without settings never changes an existing role's password.
- The foundation migration itself revokes UPDATE/DELETE/TRUNCATE on `audit_logs` from `tocs_app` (if that
  role exists), so the table is append-only even before `grants.sql` runs.
- `node scripts/verify-migrate-deploy.mjs` exercises the production path for real in scratch DB
  `tocs_migrate_test`: baseline + roles + empty `_prisma_migrations`, `prisma migrate deploy` as `tocs_migrator`
  (twice; asserts every migration directory is recorded exactly once), then grants.
