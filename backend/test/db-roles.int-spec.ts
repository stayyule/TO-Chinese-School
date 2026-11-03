import { readFileSync } from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { appRoleUrl, DEV_PASSWORD_OPTIONS, runGrants, testDatabaseUrl } from './helpers/db';

const read = (rel: string): string => readFileSync(path.resolve(__dirname, rel), 'utf8');
const INIT_ROLES = read('../../deploy/db/init-roles.sql');
const FOUNDATION = read('../prisma/migrations/20261103000000_foundation/migration.sql');
const APPEND_ONLY_BLOCK = FOUNDATION.slice(FOUNDATION.indexOf('-- audit_logs is append-only'));

describe('database roles', () => {
  let app: Client;
  let admin: Client;

  /** Runs DDL as tocs_migrator (as `prisma migrate deploy` would), so default privileges apply. */
  async function asMigrator(sql: string): Promise<void> {
    await admin.query('SET ROLE tocs_migrator');
    try {
      await admin.query(sql);
    } finally {
      await admin.query('RESET ROLE');
    }
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: testDatabaseUrl(), options: DEV_PASSWORD_OPTIONS });
    await admin.connect();
    app = new Client({ connectionString: appRoleUrl() });
    await app.connect();
  });

  afterAll(async () => {
    await app.end();
    await admin.query('TRUNCATE audit_logs'); // leave tables empty for other suites
    await admin.end();
  });

  it('tocs_app can INSERT into and SELECT from audit_logs', async () => {
    await app.query("INSERT INTO audit_logs (action) VALUES ('test.roles')");
    const { rows } = await app.query("SELECT action FROM audit_logs WHERE action = 'test.roles'");
    expect(rows).toHaveLength(1);
  });

  it('tocs_app cannot UPDATE, DELETE or TRUNCATE audit_logs', async () => {
    await expect(app.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM audit_logs')).rejects.toThrow(/permission denied/);
    await expect(app.query('TRUNCATE audit_logs')).rejects.toThrow(/permission denied/);
  });

  it('audit_logs is already append-only after the migration SQL alone (before grants.sql)', async () => {
    // Simulate the window: default privileges have just granted full DML on the new table.
    await admin.query('GRANT UPDATE, DELETE, TRUNCATE ON TABLE audit_logs TO tocs_app');
    await expect(app.query("UPDATE audit_logs SET action = 'x'")).resolves.toBeDefined(); // the hole is real
    await admin.query(APPEND_ONLY_BLOCK); // the tail of the foundation migration, no grants.sql
    await expect(app.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM audit_logs')).rejects.toThrow(/permission denied/);
    await expect(app.query('TRUNCATE audit_logs')).rejects.toThrow(/permission denied/);
    await expect(app.query("INSERT INTO audit_logs (action) VALUES ('still.insertable')")).resolves.toBeDefined();
  });

  it('tocs_app has no DDL rights', async () => {
    await expect(app.query('CREATE TABLE t (x int)')).rejects.toThrow(/permission denied/);
  });

  it('tocs_app can read and write retained tables, including new auth tables', async () => {
    await expect(app.query('SELECT * FROM users LIMIT 1')).resolves.toBeDefined();
    await app.query("INSERT INTO permissions (code) VALUES ('roles.test')"); // needs sequence usage
    await app.query("UPDATE permissions SET description = 'd' WHERE code = 'roles.test'");
    await app.query("DELETE FROM permissions WHERE code = 'roles.test'");
  });

  it('a table created later by tocs_migrator is granted by default, but grants.sql withholds the 7 unmigrated tables and their sequences', async () => {
    try {
      await asMigrator(
        'CREATE TABLE track_event_teams (id serial PRIMARY KEY); CREATE TABLE roles_legit_probe (id serial PRIMARY KEY, n int)',
      );
      // Before grants.sql the default privileges DO expose both tables: the checks below can discriminate.
      await expect(app.query('SELECT * FROM track_event_teams')).resolves.toBeDefined();
      await expect(app.query('SELECT last_value FROM track_event_teams_id_seq')).resolves.toBeDefined();

      await runGrants(admin);

      await expect(app.query('SELECT * FROM track_event_teams')).rejects.toThrow(/permission denied/);
      await expect(app.query('INSERT INTO track_event_teams DEFAULT VALUES')).rejects.toThrow(/permission denied/);
      await expect(app.query('SELECT last_value FROM track_event_teams_id_seq')).rejects.toThrow(/permission denied/);
      await expect(app.query("SELECT nextval('track_event_teams_id_seq')")).rejects.toThrow(/permission denied/);

      await app.query('INSERT INTO roles_legit_probe (n) VALUES (1)'); // table DML + sequence usage
      await app.query('UPDATE roles_legit_probe SET n = 2');
      await app.query('DELETE FROM roles_legit_probe');
    } finally {
      await admin.query('DROP TABLE IF EXISTS track_event_teams, roles_legit_probe');
    }
  });

  it('tocs_app cannot read an existing _prisma_migrations after grants.sql', async () => {
    try {
      await asMigrator('CREATE TABLE _prisma_migrations (id varchar(36) PRIMARY KEY)');
      await expect(app.query('SELECT * FROM _prisma_migrations')).resolves.toBeDefined(); // default privileges
      await runGrants(admin);
      await expect(app.query('SELECT * FROM _prisma_migrations')).rejects.toThrow(
        /permission denied for table _prisma_migrations/,
      );
    } finally {
      await admin.query('DROP TABLE IF EXISTS _prisma_migrations');
    }
  });

  it('grants.sql is idempotent', async () => {
    await runGrants(admin);
    await runGrants(admin);
    await expect(app.query('SELECT 1 FROM users LIMIT 1')).resolves.toBeDefined();
    await expect(app.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(/permission denied/);
  });
});

describe('init-roles.sql password handling', () => {
  async function client(options?: string): Promise<Client> {
    const c = new Client({ connectionString: testDatabaseUrl(), options });
    await c.connect();
    return c;
  }

  async function canLogin(password: string): Promise<boolean> {
    const u = new URL(appRoleUrl());
    u.password = password;
    const c = new Client({ connectionString: u.toString() });
    try {
      await c.connect();
      return true;
    } catch {
      return false;
    } finally {
      await c.end().catch(() => undefined);
    }
  }

  it('fails closed when passwords are unset without the dev opt-in and a role must be created', async () => {
    const c = await client();
    try {
      await c.query('BEGIN');
      await c.query('ALTER ROLE tocs_app RENAME TO tocs_app_renamed'); // so init-roles must create it (rolled back below)
      await expect(c.query(INIT_ROLES)).rejects.toThrow(/tocs\.app_password is not set/);
    } finally {
      await c.query('ROLLBACK');
      await c.end();
    }
    expect(await canLogin('tocs_app_dev')).toBe(true); // role still exists after rollback
  });

  it('never resets the password of an existing role when no password is supplied', async () => {
    const supplied = await client('-c tocs.app_password=custom-prod-pw');
    await supplied.query(INIT_ROLES);
    await supplied.end();
    expect(await canLogin('custom-prod-pw')).toBe(true);

    const bare = await client(); // no settings at all, no dev opt-in: must not raise, must not ALTER
    await bare.query(INIT_ROLES);
    await bare.end();
    expect(await canLogin('custom-prod-pw')).toBe(true);
    expect(await canLogin('tocs_app_dev')).toBe(false);

    const restore = await client('-c tocs.app_password=tocs_app_dev');
    await restore.query(INIT_ROLES);
    await restore.end();
    expect(await canLogin('tocs_app_dev')).toBe(true);
  });
});
