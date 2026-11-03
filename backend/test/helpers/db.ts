import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { Client } from 'pg';

export const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/tocs_test';

/** Explicit dev/test opt-in required by deploy/db/init-roles.sql to fall back to the dev passwords. */
export const DEV_PASSWORD_OPTIONS = '-c tocs.allow_dev_passwords=on';

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

/** Destructive helpers must never touch anything but a database named *_test. */
export function assertTestDatabase(url: string): void {
  const u = new URL(url);
  if (u.searchParams.has('database') || u.searchParams.has('dbname')) {
    throw new Error('Refusing test-DB operation: URL must not override the database via query parameters');
  }
  const name = u.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing destructive test-DB operation on database "${name}" (name must end with _test)`);
  }
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const url = testDatabaseUrl();
  assertTestDatabase(url);
  const client = new Client({ connectionString: url, options: DEV_PASSWORD_OPTIONS });
  await client.connect();
  try {
    if (!client.database?.endsWith('_test')) {
      throw new Error(`Refusing destructive test-DB operation: connected database "${client.database}" does not end with _test`);
    }
    return await fn(client);
  } finally {
    await client.end();
  }
}

const read = (rel: string): string => readFileSync(path.resolve(__dirname, rel), 'utf8');

/** The app-account connection string: same server/database as the test URL, as tocs_app. */
export function appRoleUrl(): string {
  const u = new URL(testDatabaseUrl());
  u.username = 'tocs_app';
  u.password = process.env.TOCS_APP_PASSWORD ?? 'tocs_app_dev';
  return u.toString();
}

/** (Re)applies deploy/db/grants.sql on an open superuser connection. */
export async function runGrants(c: Client): Promise<void> {
  await c.query(read('../../../deploy/db/grants.sql'));
}

/**
 * Drops and recreates schema public, then builds the schema the way production does: db/baseline.sql,
 * every migration.sql under prisma/migrations (sorted), then roles (init-roles.sql) and grants (grants.sql).
 * Test DB only.
 */
export async function loadBaseline(): Promise<void> {
  const migrationsDir = path.resolve(__dirname, '../../prisma/migrations');
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  await withClient(async (c) => {
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.query(read('../../db/baseline.sql'));
    for (const m of migrations) {
      await c.query(read(`../../prisma/migrations/${m}/migration.sql`));
    }
    await c.query(read('../../../deploy/db/init-roles.sql'));
    await runGrants(c);
  });
}

/** Truncates every table in schema public (except Prisma's migration table), restarting identities. */
export async function resetDatabase(): Promise<void> {
  await withClient(async (c) => {
    const { rows } = await c.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    if (rows.length === 0) return;
    const list = rows.map((r) => `"${r.tablename}"`).join(', ');
    await c.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  });
}
