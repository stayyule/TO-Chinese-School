-- Idempotent privilege assignment for tocs_app. Run as tocs_migrator (or a superuser) after EVERY
-- `prisma migrate deploy`; safe to re-run. Requires the roles from init-roles.sql.
--   * retained + new tables: SELECT/INSERT/UPDATE/DELETE, and their sequences
--   * audit_logs: SELECT/INSERT only (append-only)
--   * the 7 unmigrated track-event/library tables: never granted, explicitly revoked if present
--   * _prisma_migrations: no access for the app

GRANT USAGE ON SCHEMA public TO tocs_app;

DO $$
DECLARE
  unmigrated text[] := ARRAY['jersey_numbers', 'track_event_heats', 'track_event_programs', 'track_event_signups',
                             'track_event_teams', 'library_books', 'library_book_checkouts'];
  t text;
  r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
           AND tablename <> ALL (unmigrated) AND tablename NOT IN ('_prisma_migrations', 'audit_logs')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO tocs_app', r.tablename);
  END LOOP;

  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    IF EXISTS (SELECT 1 FROM unnest(unmigrated) u WHERE r.relname LIKE u || '\_%' OR r.relname = '_prisma_migrations_id_seq') THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM tocs_app', r.relname);
    ELSE
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO tocs_app', r.relname);
    END IF;
  END LOOP;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.audit_logs FROM tocs_app;
    GRANT SELECT, INSERT ON TABLE public.audit_logs TO tocs_app;
  END IF;

  FOREACH t IN ARRAY unmigrated || ARRAY['_prisma_migrations'] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM tocs_app', t);
    END IF;
  END LOOP;
END
$$;
