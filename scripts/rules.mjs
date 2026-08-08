#!/usr/bin/env node
/**
 * Keeps server/vendor/mandate-rules.ts identical to Corridor's source.
 *
 * WHY VENDOR AT ALL. The guard previously reached across the filesystem with
 * '../../../products/corridor/src/mandate-rules.ts'. That works on this laptop and nowhere else —
 * it breaks the moment either repo moves, is cloned alone, or the pilot is containerised, which
 * the committed Dockerfile says is the intent. It would have failed on first deploy, at import
 * time, with the app already built.
 *
 * WHY A HASH CHECK. Vendoring alone recreates the original sin: a second copy of the rules that
 * drifts. So the copy carries the source's hash, and `check` fails if they diverge. Corridor
 * stays the single source of truth; this is a build artifact of it.
 *
 *   node scripts/rules.mjs sync    copy from corridor + record the hash
 *   node scripts/rules.mjs check   fail if the copy has drifted   (runs in `npm test`)
 *
 * When Corridor is absent — a deployed container — `check` PASSES with a note. The vendored file
 * is the artifact there and there is nothing to compare against. It fails only when the source is
 * present and disagrees, which is the case that actually matters.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(here, '../../../products/corridor/src/mandate-rules.ts');
const VENDOR = join(here, '../server/vendor/mandate-rules.ts');
const STAMP  = join(here, '../server/vendor/mandate-rules.hash');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const cmd = process.argv[2];

if (cmd === 'sync') {
  if (!existsSync(SOURCE)) {
    console.error(`✗ corridor source not found at ${SOURCE}`);
    console.error('  Clone it next to this repo, or edit SOURCE in scripts/rules.mjs.');
    process.exit(1);
  }
  const src = readFileSync(SOURCE, 'utf8');
  mkdirSync(dirname(VENDOR), { recursive: true });
  writeFileSync(VENDOR,
    '// GENERATED — do not edit. Source of truth: corridor/src/mandate-rules.ts\n' +
    '// Regenerate with: node scripts/rules.mjs sync\n' + src);
  writeFileSync(STAMP, sha(src) + '\n');
  console.log(`✓ vendored mandate-rules.ts  (${sha(src).slice(0, 12)}…)`);
  process.exit(0);
}

if (cmd === 'check') {
  if (!existsSync(VENDOR)) { console.error('✗ server/vendor/mandate-rules.ts missing — run: node scripts/rules.mjs sync'); process.exit(1); }
  if (!existsSync(SOURCE)) { console.log('• corridor source not present (deployed artifact) — vendored rules used as-is'); process.exit(0); }
  const want = sha(readFileSync(SOURCE, 'utf8'));
  const have = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : '';
  if (want !== have) {
    console.error('✗ mandate rules have DRIFTED from corridor.');
    console.error(`    corridor: ${want.slice(0, 12)}…`);
    console.error(`    vendored: ${have.slice(0, 12) || '(none)'}…`);
    console.error('  The guard is the one enforcement site. Run: node scripts/rules.mjs sync');
    process.exit(1);
  }
  console.log(`✓ mandate rules match corridor (${want.slice(0, 12)}…)`);
  process.exit(0);
}

console.error('usage: node scripts/rules.mjs sync|check');
process.exit(2);
