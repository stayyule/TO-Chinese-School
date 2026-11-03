-- Run once, as tocs_migrator, on a database that already contains the baseline tables but was not
-- created by Prisma. Prisma refuses `migrate deploy` (P3005) on a non-empty database without a
-- _prisma_migrations table; this creates it empty (same DDL Prisma itself uses), so deploy applies
-- only the foundation migration and later ones. See backend/prisma/migrations/README.md.
CREATE TABLE IF NOT EXISTS _prisma_migrations (
  id                      VARCHAR(36) PRIMARY KEY NOT NULL,
  checksum                VARCHAR(64) NOT NULL,
  finished_at             TIMESTAMPTZ,
  migration_name          VARCHAR(255) NOT NULL,
  logs                    TEXT,
  rolled_back_at          TIMESTAMPTZ,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_steps_count     INTEGER NOT NULL DEFAULT 0
);
