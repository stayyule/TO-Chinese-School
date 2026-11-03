-- Creates the two database accounts. Pure SQL, safe to re-run, run as a superuser.
--   tocs_migrator : owns schema public and its objects, may run DDL (used by `prisma migrate deploy`).
--   tocs_app      : runtime account; DML only, granted per table by grants.sql (no DDL).
-- Dev passwords default to tocs_migrator_dev / tocs_app_dev. Override without editing this file:
--   PGOPTIONS="-c tocs.migrator_password=... -c tocs.app_password=..."   (psql / docker entrypoint)
-- The Postgres docker entrypoint runs this once on first start (see deploy/compose.dev.yml); CI and
-- the integration-test setup run it too. Run deploy/db/grants.sql afterwards (and after every migrate deploy).

DO $$
DECLARE
  migrator_pw text := coalesce(nullif(current_setting('tocs.migrator_password', true), ''), 'tocs_migrator_dev');
  app_pw      text := coalesce(nullif(current_setting('tocs.app_password', true), ''), 'tocs_app_dev');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tocs_migrator') THEN
    EXECUTE format('CREATE ROLE tocs_migrator LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', migrator_pw);
  ELSE
    EXECUTE format('ALTER ROLE tocs_migrator PASSWORD %L', migrator_pw);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tocs_app') THEN
    EXECUTE format('CREATE ROLE tocs_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', app_pw);
  ELSE
    EXECUTE format('ALTER ROLE tocs_app PASSWORD %L', app_pw);
  END IF;
END
$$;

-- Database-level: only the migrator may create objects; both may connect.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO tocs_migrator, tocs_app', current_database());
  EXECUTE format('GRANT CREATE ON DATABASE %I TO tocs_migrator', current_database());
END
$$;

-- The migrator owns the schema and every existing table/sequence in it.
ALTER SCHEMA public OWNER TO tocs_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S') AND pg_get_userbyid(c.relowner) <> 'tocs_migrator'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
      AND NOT (c.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'a'))
  LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO tocs_migrator', CASE r.relkind WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.relname);
  END LOOP;
END
$$;

-- Tables the migrator creates from now on are readable/writable by the app by default.
-- grants.sql then narrows audit_logs (append-only) and never grants the 7 unmigrated tables.
ALTER DEFAULT PRIVILEGES FOR ROLE tocs_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tocs_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tocs_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tocs_app;
