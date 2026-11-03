#!/usr/bin/env node
// End-to-end check of the production deploy path in a scratch database (name must end with _test):
// baseline.sql + init-roles.sql + deploy/db/prisma-migrations-table.sql, then a REAL
// `prisma migrate deploy` as tocs_migrator (via DATABASE_MIGRATOR_URL), then grants.sql.
//
//   node scripts/verify-migrate-deploy.mjs            (superuser URL: TOCS_ADMIN_URL, default localhost:5433)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const { Client } = createRequire(root('backend/package.json'))('pg');

const SCRATCH = 'tocs_migrate_test';
const admin = new URL(process.env.TOCS_ADMIN_URL ?? 'postgresql://postgres:postgres@localhost:5433/postgres');
const withDb = (db, user, pw) => {
  const u = new URL(admin);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = pw;
  }
  return u.toString();
};
const sql = (p) => readFileSync(root(p), 'utf8');
const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};
if (!SCRATCH.endsWith('_test')) throw new Error('scratch database must end with _test');

const su = new Client({ connectionString: withDb('postgres') });
await su.connect();
await su.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
await su.query(`CREATE DATABASE ${SCRATCH}`);
await su.end();

const s = new Client({ connectionString: withDb(SCRATCH), options: '-c tocs.allow_dev_passwords=on' });
await s.connect();
await s.query(sql('backend/db/baseline.sql'));
await s.query(sql('deploy/db/init-roles.sql'));
await s.end();

const migrator = withDb(SCRATCH, 'tocs_migrator', 'tocs_migrator_dev');
const m = new Client({ connectionString: migrator });
await m.connect();
await m.query(sql('deploy/db/prisma-migrations-table.sql'));

const env = { ...process.env, DATABASE_URL: withDb(SCRATCH, 'tocs_app', 'tocs_app_dev'), DATABASE_MIGRATOR_URL: migrator };
const deploy = () =>
  spawnSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: root('backend'), env, encoding: 'utf8', shell: true });
const first = deploy();
console.log(first.stdout + first.stderr);
assert(first.status === 0 && /successfully applied/.test(first.stdout), 'prisma migrate deploy applied the foundation migration');
const second = deploy();
assert(second.status === 0 && /No pending migrations/.test(second.stdout), 'second migrate deploy is a no-op');

const { rows } = await m.query('SELECT migration_name, finished_at IS NOT NULL AS done FROM _prisma_migrations');
assert(rows.length === 1 && rows[0].done && rows[0].migration_name.endsWith('_foundation'), '_prisma_migrations records only the foundation migration');
const t = await m.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
assert(t.rows[0].n === 34, 'public has 34 tables (29 baseline + 5 new)');
await m.query(sql('deploy/db/grants.sql'));
await m.end();

const app = new Client({ connectionString: env.DATABASE_URL });
await app.connect();
await app.query("INSERT INTO audit_logs (action) VALUES ('verify')");
let denied = false;
await app.query("UPDATE audit_logs SET action = 'x'").catch(() => (denied = true));
assert(denied, 'tocs_app cannot UPDATE audit_logs after deploy + grants');
await app.end();
console.log('verify-migrate-deploy: all checks passed');
