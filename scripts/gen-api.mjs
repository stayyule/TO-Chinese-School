// Generates frontend/src/api/generated/schema.d.ts from the backend's OpenAPI document.
// No database needed: backend `openapi:build` boots the Nest app without initialising it (see backend/src/openapi-build.ts).
// openapi-typescript lives in backend/ because it needs the TypeScript 5 compiler API (frontend uses TypeScript 7).
// Usage: node scripts/gen-api.mjs   (or `npm run gen:api` in frontend/)
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(root, 'backend');
const out = resolve(root, 'frontend/src/api/generated/schema.d.ts');

function run(args) {
  // shell:true so npm/npx .cmd shims resolve on Windows; all arguments are fixed strings or repo paths.
  const r = spawnSync(args.join(' '), { cwd: backend, stdio: 'inherit', shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

mkdirSync(dirname(out), { recursive: true });
run(['npm', 'run', 'openapi:build']);
run(['npx', '--no-install', 'openapi-typescript', 'openapi.json', '-o', `"${out}"`]);
