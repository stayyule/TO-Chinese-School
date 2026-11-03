#!/usr/bin/env node
// Fails (exit 1) if any migration.sql under <dir> contains a destructive statement:
// DROP, TRUNCATE, ALTER TABLE ... DROP COLUMN or RENAME. A statement is allowed only when the
// previous non-blank line is `-- allow-destructive: <non-empty reason>`.
//
//   node scripts/check-migrations.mjs backend/prisma/migrations
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESTRUCTIVE = /\bDROP\s|\bTRUNCATE\b|\bRENAME\b/i;
const ALLOW = /^\s*--\s*allow-destructive:\s*(\S.*)$/;

/** Blanks out comments and string literals, preserving newlines and offsets. */
function mask(sql) {
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < sql.length) {
    const rest = sql.slice(i);
    let m;
    if ((m = /^--[^\n]*/.exec(rest)) || (m = /^\/\*[\s\S]*?(\*\/|$)/.exec(rest)) || (m = /^'(?:[^']|'')*('|$)/.exec(rest))) {
      out += blank(m[0]);
      i += m[0].length;
    } else {
      out += sql[i++];
    }
  }
  return out;
}

export function checkSql(sql) {
  const rawLines = sql.split('\n');
  const masked = mask(sql);
  const problems = [];
  let offset = 0;
  for (const stmt of masked.split(';')) {
    const startOffset = offset;
    offset += stmt.length + 1;
    if (!DESTRUCTIVE.test(stmt)) continue;
    const lead = stmt.length - stmt.trimStart().length;
    const firstLine = masked.slice(0, startOffset + lead).split('\n').length; // 1-based
    let p = firstLine - 2;
    while (p >= 0 && rawLines[p].trim() === '') p--;
    if (p >= 0 && ALLOW.test(rawLines[p])) continue;
    const bad = stmt.split('\n').findIndex((l) => DESTRUCTIVE.test(l));
    const line = masked.slice(0, startOffset).split('\n').length + bad;
    problems.push({ line, text: rawLines[line - 1].trim() });
  }
  return problems;
}

function findMigrationFiles(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return findMigrationFiles(p);
      return name === 'migration.sql' ? [p] : [];
    });
}

function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) {
    console.error('usage: check-migrations.mjs <migrations-dir>');
    process.exit(2);
  }
  let failed = false;
  for (const file of findMigrationFiles(dir)) {
    for (const p of checkSql(readFileSync(file, 'utf8'))) {
      failed = true;
      console.error(`${file}:${p.line}: destructive statement without "-- allow-destructive: <reason>": ${p.text}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
