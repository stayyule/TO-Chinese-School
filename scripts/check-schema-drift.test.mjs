import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffSchemas, parseSchema } from './check-schema-drift.mjs';

const baseline = `
CREATE TABLE people (
  id serial PRIMARY KEY, -- comment, with comma
  name varchar(255),
  score numeric(10,2) NOT NULL DEFAULT 0
);
CREATE TABLE only_base (id integer);
CREATE TABLE track_event_heats (id integer);
`;

const pgDump = `
CREATE TABLE public.people (
    id integer NOT NULL,
    name character varying(255),
    "extra" text,
    CONSTRAINT people_pkey PRIMARY KEY (id)
);
CREATE TABLE public.only_prod (
    id integer
);
CREATE TABLE public.schema_migrations (version character varying NOT NULL);
`;

test('parseSchema handles baseline style and pg_dump style', () => {
  const b = parseSchema(baseline);
  assert.deepEqual([...b.get('people')], ['id', 'name', 'score']);
  const p = parseSchema(pgDump);
  assert.deepEqual([...p.get('people')], ['id', 'name', 'extra']);
});

test('diffSchemas lists one-sided tables and columns, ignoring unmigrated tables', () => {
  const diff = diffSchemas(parseSchema(baseline), parseSchema(pgDump));
  assert.deepEqual(diff, [
    'table only in baseline: only_base',
    'column only in baseline: people.score',
    'column only in production: people.extra',
    'table only in production: only_prod',
  ]);
});

test('CLI exits non-zero on drift and zero when identical', () => {
  const dir = mkdtempSync(join(tmpdir(), 'drift-'));
  const script = new URL('./check-schema-drift.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const drifted = join(dir, 'drift.sql');
  writeFileSync(drifted, pgDump);
  const r = spawnSync(process.execPath, [script, drifted], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /table only in production: only_prod/);
  const real = execFileSync(process.execPath, [script, new URL('../backend/db/baseline.sql', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
  assert.match(real, /OK/);
});
