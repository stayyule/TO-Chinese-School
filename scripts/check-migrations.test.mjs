import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-migrations.mjs', import.meta.url));

function run(sqlByName) {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  for (const [name, sql] of Object.entries(sqlByName)) {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'migration.sql'), sql);
  }
  return spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
}

test('DROP TABLE fails and is reported with file:line', () => {
  const r = run({ m1: 'CREATE TABLE a (x int);\nDROP TABLE x;\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /m[\/]?1?.*migration\.sql:2/);
});

test('DROP TABLE with allow-destructive reason passes', () => {
  const r = run({ m1: '-- allow-destructive: replaced by v2\n\nDROP TABLE x;\n' });
  assert.equal(r.status, 0, r.stderr);
});

test('allow marker with an empty reason does not count', () => {
  assert.equal(run({ m1: '-- allow-destructive:\nDROP TABLE x;\n' }).status, 1);
  assert.equal(run({ m1: '-- allow-destructive:   \nDROP TABLE x;\n' }).status, 1);
});

test('allow marker must immediately precede the statement', () => {
  const r = run({ m1: '-- allow-destructive: ok\nCREATE TABLE a (x int);\nDROP TABLE x;\n' });
  assert.equal(r.status, 1);
});

test('allow marker covers a multi-line statement', () => {
  const r = run({ m1: '-- allow-destructive: ok\nALTER TABLE a\n  DROP COLUMN b;\n' });
  assert.equal(r.status, 0, r.stderr);
});

test('TRUNCATE, ALTER TABLE DROP COLUMN, RENAME fail (case-insensitive)', () => {
  for (const sql of ['truncate t;', 'ALTER TABLE a DROP COLUMN b;', 'alter table a rename to c;', 'ALTER TABLE a RENAME COLUMN b TO c;', 'drop index i;']) {
    assert.equal(run({ m1: sql + '\n' }).status, 1, sql);
  }
});

test('CREATE TABLE / ADD COLUMN / CREATE INDEX pass', () => {
  const r = run({
    m1: 'CREATE TABLE a (id bigserial PRIMARY KEY);\nALTER TABLE users ADD COLUMN password_hash_v2 text;\nCREATE UNIQUE INDEX i ON a(id);\n',
  });
  assert.equal(r.status, 0, r.stderr);
});

test('keywords inside comments and string literals are ignored', () => {
  const r = run({ m1: "-- DROP TABLE x; TRUNCATE\n/* RENAME */ CREATE TABLE a (n text DEFAULT 'DROP TABLE');\n" });
  assert.equal(r.status, 0, r.stderr);
});

test('scans nested migration files recursively and fails if any is bad', () => {
  const r = run({ ok: 'CREATE TABLE a (x int);\n', 'nested/bad': 'TRUNCATE a;\n' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bad/);
});

test('missing directory is an error', () => {
  const r = spawnSync(process.execPath, [script, join(tmpdir(), 'does-not-exist-xyz')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});
