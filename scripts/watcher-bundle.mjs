#!/usr/bin/env node
// Bundles the Mac watcher, as compiled by `tsc -p watcher/tsconfig.json`, into
// one file the installer downloads: public/watcher/bottega-watcher.cjs
// (REQUIREMENTS A-11, docs/watcher.md). Part of `npm run watcher:build`, which
// `npm run build` runs first, so every deploy serves the watcher of its own
// commit.
//
//   node scripts/watcher-bundle.mjs
//
// The compiled files are CommonJS. Each becomes a function in one table; a
// relative require() is looked up in the table and anything else (node:fs and
// the like) goes to Node's own. A require of a package fails the build: the
// watcher runs with nothing installed beside it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'watcher', 'dist');
const ENTRY = join(DIST, 'watcher', 'main.js');
const OUT = join(ROOT, 'public', 'watcher', 'bottega-watcher.cjs');

const REQUIRE = /\brequire\(\s*(["'])([^"']+)\1\s*\)/g;

function resolveFile(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const p of [base, `${base}.js`, join(base, 'index.js')]) if (existsSync(p) && p.endsWith('.js')) return p;
  throw new Error(`watcher-bundle: cannot find ${spec}, required by ${relative(ROOT, from)}`);
}

if (!existsSync(ENTRY)) {
  console.error('watcher-bundle: compile first (tsc -p watcher/tsconfig.json).');
  process.exit(1);
}

const modules = new Map(); // absolute path → { id, source, map }
const queue = [ENTRY];
while (queue.length) {
  const file = queue.shift();
  if (modules.has(file)) continue;
  const source = readFileSync(file, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/m, '');
  const map = {};
  for (const [, , spec] of source.matchAll(REQUIRE)) {
    if (spec.startsWith('.')) {
      const target = resolveFile(file, spec);
      map[spec] = relative(DIST, target);
      queue.push(target);
    } else if (!spec.startsWith('node:') && !builtinModules.includes(spec)) {
      throw new Error(`watcher-bundle: ${relative(ROOT, file)} requires the package “${spec}”; the watcher must use Node's own modules only.`);
    }
  }
  modules.set(file, { id: relative(DIST, file), source, map });
}

const version = readFileSync(join(ROOT, 'watcher', 'main.ts'), 'utf8').match(/const VERSION = '([^']+)'/)?.[1] ?? 'unknown';
const table = [...modules.values()]
  .map(
    (m) =>
      `  ${JSON.stringify(m.id)}: [${JSON.stringify(m.map)}, function (exports, require, module) {\n${m.source}\n  }],`,
  )
  .join('\n');

const bundle = `#!/usr/bin/env node
// Bottega's Mac watcher ${version}, bundled by scripts/watcher-bundle.mjs from
// watcher/main.ts and lib/als. Installed by public/watcher/install.sh; see docs/watcher.md.
'use strict';
(function () {
const modules = {
${table}
};
const cache = {};
const nodeRequire = require;
function load(id) {
  if (cache[id]) return cache[id].exports;
  const [map, fn] = modules[id];
  const module = (cache[id] = { exports: {} });
  fn.call(module.exports, module.exports, (spec) => (spec in map ? load(map[spec]) : nodeRequire(spec)), module);
  return module.exports;
}
load(${JSON.stringify(relative(DIST, ENTRY))});
})();
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bundle, { mode: 0o644 });
console.log(`watcher-bundle: ${modules.size} files, ${(bundle.length / 1024).toFixed(0)} KB → ${relative(ROOT, OUT)} (watcher ${version})`);
