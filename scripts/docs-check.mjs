#!/usr/bin/env node
/**
 * docs-check — fails when the documentation describes a codebase that no longer exists.
 *
 * Runs as part of `npm test`, so a change that invalidates a document breaks the build in the same
 * commit that caused it rather than months later when someone follows an instruction that stopped
 * working. The usual way docs rot is not neglect: it is a rename nobody thought to grep for.
 *
 * It checks only claims that can be checked mechanically:
 *
 *   1. every source file cited in a doc exists
 *   2. every `npm run <script>` referenced is defined in package.json
 *   3. every HTTP route cited is registered in server/index.mjs
 *   4. every rate limit quoted in SECURITY.md matches server/ratelimit.mjs
 *
 * It cannot check whether the prose is TRUE — only that its references resolve. Judgement stays a
 * human job; this catches the mechanical half that silently breaks.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/*
 * Documents that describe code that EXISTS, and must therefore stay true.
 *
 * docs/specs/ is deliberately absent: a spec describes what has not been built, so its file and
 * route references are supposed to be unresolvable. Checking them would force either a spec that
 * cannot mention anything new, or a checker nobody trusts because it always fails.
 * docs/decisions/ is absent for a related reason: an ADR records a decision at a point in time,
 * including options that were rejected and never existed.
 */
const DOCS = ['README.md', 'DEPLOY.md', 'docs/ARCHITECTURE.md', 'docs/SECURITY.md',
              'docs/OPERATIONS.md', 'docs/KNOWN-ISSUES.md', 'docs/COPY-CLAIMS.md',
              // A performance document is mostly file and script references, which is exactly the
              // kind of claim that rots silently after a rename.
              'docs/design/PERFORMANCE.md'];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const problems = [];
const note = (doc, msg) => problems.push(`${doc}: ${msg}`);

const docs = DOCS.filter((d) => existsSync(join(ROOT, d))).map((d) => [d, read(d)]);

/* 1 ── cited source files exist ─────────────────────────────────────────────────────────── */
// `jsx` BEFORE `js` in the alternation: regex alternation is ordered, so `js` would match first
// and truncate every .jsx path to .js — which is exactly the false positive this check first
// produced when written the other way round.
const FILE = /`((?:server|src|scripts|shared|test)\/[A-Za-z0-9_./-]+\.(?:mjs|jsx|ts|js))/g;
for (const [doc, text] of docs) {
  for (const [, f] of text.matchAll(FILE)) {
    if (!existsSync(join(ROOT, f))) note(doc, `cites a file that does not exist: ${f}`);
  }
}

/* 2 ── referenced npm scripts are defined ───────────────────────────────────────────────── */
const scripts = new Set(Object.keys(JSON.parse(read('package.json')).scripts ?? {}));
for (const [doc, text] of docs) {
  for (const [, s] of text.matchAll(/npm run ([a-z][a-z:0-9-]*)/g)) {
    if (!scripts.has(s)) note(doc, `references an undefined npm script: ${s}`);
  }
}

/* 3 ── cited routes are registered ──────────────────────────────────────────────────────── */
const server = read('server/index.mjs');
const routes = new Set([...server.matchAll(/route\('(?:GET|POST)', '([^']+)'/g)].map((m) => m[1]));
for (const [doc, text] of docs) {
  for (const [, r] of text.matchAll(/`(?:GET|POST|GET\/POST) (\/[^`\s]+)`/g)) {
    if (r.includes(':') || r.includes('{')) continue;      // parameterised or a placeholder
    if (routes.has(r)) continue;
    // Not every served path is a route(): /agent/skill.md is handled by the static branch. Accept
    // any path the server source mentions literally, and only complain about ones it never names.
    const base = r.split('/').filter(Boolean).pop();
    if (base && server.includes(base)) continue;
    note(doc, `documents a path the server never mentions: ${r}`);
  }
}

/* 4 ── quoted rate limits match the code ────────────────────────────────────────────────── */
const limits = Object.fromEntries(
  [...read('server/ratelimit.mjs').matchAll(/(\w+):\s*\{\s*max:\s*(\d+)/g)].map((m) => [m[1], m[2]]));
const sec = docs.find(([d]) => d.endsWith('SECURITY.md'))?.[1];
if (sec) {
  for (const [, name, max] of sec.matchAll(/\|\s*`(\w+)`\s*\|\s*(\d+)\s*\//g)) {
    if (limits[name] === undefined) note('docs/SECURITY.md', `documents an unknown limit: ${name}`);
    else if (limits[name] !== max) {
      note('docs/SECURITY.md', `${name} documented as ${max}, code says ${limits[name]}`);
    }
  }
  // The reverse direction matters too: a NEW limit that nobody documented is the more likely drift.
  for (const name of Object.keys(limits)) {
    if (!sec.includes(`\`${name}\``)) note('docs/SECURITY.md', `limit not documented: ${name}`);
  }
}

/* ── report ─────────────────────────────────────────────────────────────────────────────── */
if (problems.length) {
  console.error(`\n  docs-check: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`    ✗ ${p}`);
  console.error('\n  Fix the document or the code — they disagree.\n');
  process.exit(1);
}
console.log(`  docs-check: ${docs.length} documents consistent with the code`);
