-- Creates the two database accounts. Pure SQL, safe to re-run, run as a superuser.
--   tocs_migrator : owns schema public and its objects, may run DDL (used by `prisma migrate deploy`).
--   tocs_app      : runtime account; DML only, granted per table by grants.sql (no DDL).
-- Passwords are supplied as custom settings (psql / docker entrypoint honour PGOPTIONS):
--   PGOPTIONS="-c tocs.migrator_password=... -c tocs.app_password=..."
-- Fails closed: a missing password for a role that must be CREATED raises an error, unless the explicit
-- opt-in `-c tocs.allow_dev_passwords=on` is set (dev compose, tests), which uses the dev defaults
-- tocs_migrator_dev / tocs_app_dev. The password of an EXISTING role is only changed when its setting
-- is explicitly supplied; a re-run without settings never resets passwords.
-- Run deploy/db/grants.sql afterwards (and after every migrate deploy).

DO $$
DECLARE
  allow_dev boolean := coalesce(current_setting('tocs.allow_dev_passwords', true), '') = 'on';
  r record;
  pw text;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('tocs_migrator', 'tocs.migrator_password', 'tocs_migrator_dev'),
                                 ('tocs_app', 'tocs.app_password', 'tocs_app_dev')) AS v(role, setting, dev_default)
  LOOP
    pw := nullif(current_setting(r.setting, true), '');
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.role) THEN
      IF pw IS NULL THEN
        IF NOT allow_dev THEN
          RAISE EXCEPTION 'init-roles: % is not set; supply it via PGOPTIONS or set tocs.allow_dev_passwords=on (dev only)', r.setting;
        END IF;
        pw := r.dev_default;
      END IF;
      EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', r.role, pw);
    ELSIF pw IS NOT NULL THEN
      EXECUTE format('ALTER ROLE %I PASSWORD %L', r.role, pw);
    END IF;
  END LOOP;
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
