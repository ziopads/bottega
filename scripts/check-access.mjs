#!/usr/bin/env node
// Fails when a page, route handler or Server Action under app/ reaches data
// without first asking who is asking (ARCHITECTURE §11, REQUIREMENTS AC-10).
//
//   npm run check        (type check, then this)
//   node scripts/check-access.mjs
//
// A file passes when it calls one of the guards from lib/access.ts. The
// database refuses on its own whatever a file forgets; this catches the
// forgetting before it ships, and keeps refusals readable.
//
// Exempt: the sign-in and sign-up pages and Neon Auth's proxy (they come before anyone is
// known), and, from Phase 1, the OAuth and .well-known paths the connector
// uses, which check tokens instead, and the watcher's installer claiming a
// Mac with its one-time setup code (api/watcher/claim, db/027).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const APP = join(ROOT, 'app');

const CHECKED = /(^|\/)(page\.tsx|route\.ts|actions\.ts)$/;
const EXEMPT = [/^app\/auth\/sign-in\//, /^app\/auth\/sign-up\//, /^app\/api\/auth\//, /^app\/oauth\//, /^app\/\.well-known\//, /^app\/api\/mcp\//, /^app\/api\/watcher\/claim\//];
// tokenAccount (lib/tokens.ts): the Mac watcher's routes, signed in with a personal access token.
const GUARDS = /\b(requireAccount|requirePlatformAdmin|apiAccount|getAccount|tokenAccount)\s*\(/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const failures = [];
let checked = 0;
for (const file of walk(APP)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  if (!CHECKED.test(rel) || EXEMPT.some((re) => re.test(rel))) continue;
  checked++;
  if (!GUARDS.test(readFileSync(file, 'utf8'))) failures.push(rel);
}

if (failures.length) {
  console.error('These files never call requireAccount, requirePlatformAdmin, apiAccount or getAccount:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check-access: ${checked} pages, routes and actions call a guard.`);
