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
// Every pure rule module shared with corridor. Add here, never copy by hand.
const FILES = ['mandate-rules.ts', 'trust-rules.ts'];
const srcOf    = (f) => join(here, '../../../products/corridor/src/', f);
const vendorOf = (f) => join(here, '../server/vendor/', f);
const stampOf  = (f) => join(here, '../server/vendor/', f.replace(/\.ts$/, '.hash'));

const sha = (s) => createHash('sha256').update(s).digest('hex');
const cmd = process.argv[2];

if (cmd === 'sync') {
  for (const f of FILES) {
    const SOURCE = srcOf(f);
    if (!existsSync(SOURCE)) {
      console.error(`✗ corridor source not found at ${SOURCE}`);
      console.error('  Clone it next to this repo, or edit the path in scripts/rules.mjs.');
      process.exit(1);
    }
    const src = readFileSync(SOURCE, 'utf8');
    mkdirSync(dirname(vendorOf(f)), { recursive: true });
    writeFileSync(vendorOf(f),
      `// GENERATED — do not edit. Source of truth: corridor/src/${f}\n` +
      '// Regenerate with: node scripts/rules.mjs sync\n' + src);
    writeFileSync(stampOf(f), sha(src) + '\n');
    console.log(`✓ vendored ${f}  (${sha(src).slice(0, 12)}…)`);
  }
  process.exit(0);
}

if (cmd === 'check') {
  let drifted = false;
  for (const f of FILES) {
    const SOURCE = srcOf(f);
    if (!existsSync(vendorOf(f))) {
      console.error(`✗ server/vendor/${f} missing — run: node scripts/rules.mjs sync`);
      process.exit(1);
    }
    if (!existsSync(SOURCE)) {
      console.log(`• corridor absent (deployed artifact) — vendored ${f} used as-is`);
      continue;
    }
    const want = sha(readFileSync(SOURCE, 'utf8'));
    const have = existsSync(stampOf(f)) ? readFileSync(stampOf(f), 'utf8').trim() : '';
    if (want !== have) {
      console.error(`✗ ${f} has DRIFTED from corridor.`);
      console.error(`    corridor: ${want.slice(0, 12)}…`);
      console.error(`    vendored: ${have.slice(0, 12) || '(none)'}…`);
      drifted = true;
    } else {
      console.log(`✓ ${f} matches corridor (${want.slice(0, 12)}…)`);
    }
  }
  if (drifted) {
    console.error('  These are the ONLY enforcement/derivation sites. Run: node scripts/rules.mjs sync');
    process.exit(1);
  }
  process.exit(0);
}

console.error('usage: node scripts/rules.mjs sync|check');
process.exit(2);
