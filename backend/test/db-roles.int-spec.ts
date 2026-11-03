import { Client } from 'pg';
import { appRoleUrl, runGrants, testDatabaseUrl } from './helpers/db';

describe('database roles', () => {
  let app: Client;
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: testDatabaseUrl() });
    await admin.connect();
    app = new Client({ connectionString: appRoleUrl() });
    await app.connect();
  });

  afterAll(async () => {
    await app.end();
    await admin.end();
  });

  it('tocs_app can INSERT into and SELECT from audit_logs', async () => {
    await app.query("INSERT INTO audit_logs (action) VALUES ('test.roles')");
    const { rows } = await app.query("SELECT action FROM audit_logs WHERE action = 'test.roles'");
    expect(rows).toHaveLength(1);
  });

  it('tocs_app cannot UPDATE or DELETE audit_logs', async () => {
    await expect(app.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(/permission denied/);
    await expect(app.query('DELETE FROM audit_logs')).rejects.toThrow(/permission denied/);
    await expect(app.query('TRUNCATE audit_logs')).rejects.toThrow(/permission denied/);
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

  it('tocs_app cannot read _prisma_migrations', async () => {
    await expect(app.query('SELECT * FROM _prisma_migrations')).rejects.toThrow(/permission denied|does not exist/);
  });

  it('tocs_app has no access to an unmigrated track-event table after grants.sql', async () => {
    try {
      await admin.query('CREATE TABLE track_event_teams (id serial PRIMARY KEY)');
      await runGrants(admin);
      await expect(app.query('SELECT * FROM track_event_teams')).rejects.toThrow(/permission denied/);
      await expect(app.query('INSERT INTO track_event_teams DEFAULT VALUES')).rejects.toThrow(/permission denied/);
    } finally {
      await admin.query('DROP TABLE IF EXISTS track_event_teams');
    }
  });

  it('grants.sql is idempotent', async () => {
    await runGrants(admin);
    await runGrants(admin);
    await expect(app.query('SELECT 1 FROM users LIMIT 1')).resolves.toBeDefined();
  });
});
