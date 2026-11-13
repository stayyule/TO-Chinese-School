#!/usr/bin/env node
// Compares the tables/columns of a production schema dump (pg_dump --schema-only) with
// backend/db/baseline.sql, and optionally reports duplicate join-table pairs in a live DB.
//
//   node scripts/check-schema-drift.mjs <prod-schema.sql>
//   node scripts/check-schema-drift.mjs --duplicates <postgres-url>
//
// Exit code is non-zero when any difference or duplicate is found.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASELINE = fileURLToPath(new URL('../backend/db/baseline.sql', import.meta.url));

// Tables that legitimately exist in production but are not part of the new schema.
export const IGNORED_TABLES = new Set([
  'jersey_numbers',
  'track_event_heats',
  'track_event_programs',
  'track_event_signups',
  'track_event_teams',
  'library_books',
  'library_book_checkouts',
  'schema_migrations',
  '_prisma_migrations',
]);

const CONSTRAINT_START = /^(constraint|primary|unique|foreign|check|like|exclude)\b/i;

function unquote(s) {
  return s.replace(/^"|"$/g, '');
}

/** Returns Map<table, Set<column>> from simple CREATE TABLE statements. */
export function parseSchema(sql) {
  const text = sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
  const tables = new Map();
  const head = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?\w+"?\.)?"?\w+"?)\s*\(/gi;
  let m;
  while ((m = head.exec(text)) !== null) {
    const name = unquote(m[1].split('.').pop());
    let depth = 1;
    let i = head.lastIndex;
    let start = i;
    const parts = [];
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 1) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(text.slice(start, i - 1));
    const cols = new Set();
    for (const p of parts) {
      const def = p.trim();
      if (!def || CONSTRAINT_START.test(def)) continue;
      cols.add(unquote(def.split(/\s+/)[0]));
    }
    tables.set(name, cols);
  }
  return tables;
}

/** Lists differences; `base` is the baseline, `prod` the production dump. */
export function diffSchemas(base, prod) {
  const out = [];
  const keep = (t) => !IGNORED_TABLES.has(t);
  for (const t of [...base.keys()].filter(keep).sort()) {
    if (!prod.has(t)) {
      out.push(`table only in baseline: ${t}`);
      continue;
    }
    for (const c of [...base.get(t)].sort()) {
      if (!prod.get(t).has(c)) out.push(`column only in baseline: ${t}.${c}`);
    }
    for (const c of [...prod.get(t)].sort()) {
      if (!base.get(t).has(c)) out.push(`column only in production: ${t}.${c}`);
    }
  }
  for (const t of [...prod.keys()].filter(keep).sort()) {
    if (!base.has(t)) out.push(`table only in production: ${t}`);
  }
  return out;
}

const PAIRS = [
  ['families_children', 'family_id', 'child_id'],
  ['rights_roles', 'right_id', 'role_id'],
  ['roles_users', 'role_id', 'user_id'],
];

async function checkDuplicates(url) {
  const require = createRequire(new URL('../backend/package.json', import.meta.url));
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  const out = [];
  try {
    for (const [table, a, b] of PAIRS) {
      const dup = await client.query(
        `SELECT ${a} AS a, ${b} AS b, count(*)::int AS n FROM ${table}
         WHERE ${a} IS NOT NULL AND ${b} IS NOT NULL GROUP BY ${a}, ${b} HAVING count(*) > 1 ORDER BY 1, 2`,
      );
      for (const r of dup.rows) out.push(`duplicate in ${table}: (${a}=${r.a}, ${b}=${r.b}) x${r.n}`);
      // The Prisma composite @@id requires both columns to be non-null.
      const nul = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${a} IS NULL OR ${b} IS NULL`);
      if (nul.rows[0].n > 0) out.push(`rows with NULL key in ${table}: ${nul.rows[0].n}`);
    }
  } finally {
    await client.end();
  }
  return out;
}

async function main(argv) {
  let findings;
  if (argv[0] === '--duplicates' && argv[1]) {
    findings = await checkDuplicates(argv[1]);
  } else if (argv.length === 1 && !argv[0].startsWith('--')) {
    findings = diffSchemas(parseSchema(readFileSync(BASELINE, 'utf8')), parseSchema(readFileSync(argv[0], 'utf8')));
  } else {
    console.error('usage: check-schema-drift.mjs <prod-schema.sql> | --duplicates <db-url>');
    return 2;
  }
  if (findings.length === 0) {
    console.log('OK: no differences found');
    return 0;
  }
  console.log(findings.join('\n'));
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.message);
      process.exit(2);
    },
  );
}
