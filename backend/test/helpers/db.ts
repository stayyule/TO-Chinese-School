import { readFileSync } from 'fs';
import * as path from 'path';
import { Client } from 'pg';

export const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/tocs_test';

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

/** Destructive helpers must never touch anything but a database named *_test. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing destructive test-DB operation on database "${name}" (name must end with _test)`);
  }
}

async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const url = testDatabaseUrl();
  assertTestDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Drops and recreates schema public, then applies db/baseline.sql. Test DB only. */
export async function loadBaseline(): Promise<void> {
  const sql = readFileSync(path.resolve(__dirname, '../../db/baseline.sql'), 'utf8');
  await withClient(async (c) => {
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.query(sql);
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
