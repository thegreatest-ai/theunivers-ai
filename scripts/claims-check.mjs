#!/usr/bin/env node
/**
 * claims-check — fails the build when user-facing copy says something the system does not do.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────────────────
 *
 * Two false statements shipped on 2026-08-10, and neither was a typo. Both were TRUE when written
 * and became false when configuration changed underneath them:
 *
 *   "Private pilot · invite required"   true until INVITE_REQUIRED went to false. It then spent
 *                                       hours turning people away from a door that was open.
 *   "Enter private pilot ✦"             same cause, same morning.
 *
 * A third was caught in a mockup before it shipped: "All messages are secured with end-to-end
 * encryption", which was never true at all — messages are plaintext in SQLite.
 *
 * Tests cover behaviour and `docs-check` covers documentation, but nothing reads the prose a user
 * actually sees. This does. It is deliberately narrow: it does not judge tone or grammar, only
 * whether a specific claim is currently supportable.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Two kinds of claim:
 *
 *   NEVER      the system cannot support it in any configuration. Encryption at rest, end-to-end
 *              messaging — these are architecture, not settings, and copy asserting them is wrong
 *              no matter what any variable says.
 *
 *   CONDITIONAL true only while some configuration holds. These are the dangerous ones, because
 *              they were honest when written and nothing announces when they stop being so.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Configuration, as production actually runs ───────────────────────────────────────────
 * fly.toml is the source of truth: it is what production runs, and .env is a developer's local
 * machine. Reading .env here would let a laptop's settings vouch for a claim on the live site.  */
function productionEnv() {
  const env = {};
  if (!existsSync(join(ROOT, 'fly.toml'))) return env;
  const toml = readFileSync(join(ROOT, 'fly.toml'), 'utf8');
  const block = toml.split(/^\[env\]$/m)[1];
  if (!block) return env;
  for (const line of block.split('\n')) {
    if (/^\s*\[/.test(line)) break;                       // next section begins
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#\n]*)"?/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

/**
 * Does the repo contain code that takes money? Used by the "free" claim.
 *
 * Matches CODE, not prose. The first version searched for the word "billing" and found it in a
 * comment in metrics.mjs explaining that Fly's API exposes a `billingStatus` field — concluding
 * this project charges people. A word in a sentence is not a payment integration.
 */
const BILLING_CODE = /from\s+['"]stripe|api\.stripe\.com|checkout\.sessions|createSubscription|paypal\.com\/v[0-9]|razorpay/i;
const hasBillingCode = () =>
  ['server', 'src'].some((dir) => walk(join(ROOT, dir))
    .some((f) => BILLING_CODE.test(visibleText(readFileSync(f, 'utf8')))));

/* ── The claims ──────────────────────────────────────────────────────────────────────────── */

const ENV = productionEnv();

const CLAIMS = [
  {
    id: 'invite-gate',
    // The separator is REQUIRED, not optional. Written as `invite[- ]?` this matched the
    // IDENTIFIER `oauth.inviteRequired` in four places — variable names are not claims, and a
    // checker that flags code for being about a subject is unusable. Prose says "invite required"
    // or "Invite-only"; code says inviteRequired.
    pattern: /invite[- ](?:required|only)|private pilot/i,
    holds: () => String(ENV.INVITE_REQUIRED ?? 'true').toLowerCase() !== 'false',
    why: 'copy says registration is gated',
    fix: 'INVITE_REQUIRED is "false" in fly.toml — registration is open, so remove or reword this',
  },
  {
    id: 'e2e-encryption',
    pattern: /end[- ]to[- ]end encrypt/i,
    holds: () => false,
    why: 'messages are plaintext in SQLite and readable by anyone with `fly ssh`',
    fix: 'say "Encrypted in transit. Stored on our servers." — see docs/design/REVIEW-bridge-ui.md',
  },
  {
    id: 'encryption-at-rest',
    pattern: /encrypted at rest|zero[- ]knowledge/i,
    holds: () => false,
    why: 'the SQLite file is not encrypted; the Fly volume is, which is not the same claim',
    fix: 'describe volume encryption specifically, or say nothing',
  },
  {
    id: 'free',
    // "free zone" is a UAE licensing term and appears in registrations.js; "freedom", "free of
    // charge" in a legal note. Only PRICING shapes count.
    pattern: /\bfree (?:while|forever|plan|tier|to use|for ever)\b|\bfor free\b|\bfree, no\b/i,
    holds: () => !hasBillingCode(),
    why: 'copy says the product is free',
    fix: 'billing code exists in the repo — check the claim still holds',
  },
  {
    id: 'custody',
    pattern: /\bwallet\b|we hold your (?:funds|money)|held in escrow by us/i,
    holds: () => false,
    why: 'the platform never holds funds — custody is the licensable act under CBUAE Article 62',
    fix: 'see docs/decisions/ADR-0002 and the payment boundary in docs/specs/ORDER-AND-INSPECTION.md',
  },
];

/* ── Reading only what a user sees ───────────────────────────────────────────────────────── */

/**
 * Strip comments before scanning.
 *
 * Not a nicety: this very repo explains these bugs in comments that quote the offending copy
 * verbatim, so a scanner that read comments would fail on the files documenting the fix — and the
 * obvious "fix" would be to delete the explanation. A checker that punishes documentation trains
 * people to remove it.
 *
 * A real parser would be better. This is deliberately simple and errs toward stripping too much:
 * a missed claim is a bug to catch later, a false positive is a broken build for everyone now.
 *
 * KNOWN LIMIT: this reads whole lines, not string literals, so patterns must be written to match
 * prose rather than identifiers. Parsing JSX properly to extract only rendered text would remove
 * that constraint, and is the right change if the claim list grows much beyond this.
 */
export function visibleText(source) {
  // Blank a comment out IN PLACE, keeping its newlines. Collapsing a multi-line comment to a
  // single space shifts every line after it, and the first version of this file reported
  // "SignIn.jsx:79" for a match that was nowhere near line 79. A checker that points at the wrong
  // line is worse than one that says nothing: it sends you to edit innocent code.
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blank)   // {/* JSX comments */}
    .replace(/\/\*[\s\S]*?\*\//g, blank)                // /* block */
    .replace(/^(\s*)\/\/.*$/gm, '$1')                    // // whole-line
    .replace(/([^:])\/\/[^\n'"`]*$/gm, '$1');             // trailing //, avoiding URLs
}

/**
 * `claims-ok:<id>` exempts the next few lines from one claim.
 *
 * Needed for copy that is CONDITIONAL on the very setting being checked. SignIn renders "Invite
 * code" only when `providers.inviteRequired` is true, so the words are correct precisely because
 * they are gated — a checker reading the file cannot see that, and without an escape hatch the
 * only way to pass would be to delete working, correct code.
 *
 * It is a comment, so a human wrote a reason and the reason shows up in the diff. Scoped to a few
 * lines rather than the whole file, so it cannot quietly cover something added later.
 */
const PRAGMA = /claims-ok:\s*([a-z-]+)/g;
const EXEMPT_LINES = 6;

function exemptions(source) {
  const found = [];
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(PRAGMA)) found.push({ id: m[1], from: i + 1, to: i + 1 + EXEMPT_LINES });
  });
  return found;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : walk(p);
    return ['.jsx', '.js', '.html', '.mjs'].includes(extname(p)) ? [p] : [];
  });
}

/* ── main ────────────────────────────────────────────────────────────────────────────────── */

// Only what ships to a browser. Server files carry the same words in explanatory comments and in
// error strings that are conditional on the very configuration being checked.
const files = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html')].filter(existsSync);
const problems = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const text = visibleText(source);
  const exempt = exemptions(source);
  const lines = text.split('\n');

  for (const claim of CLAIMS) {
    if (claim.holds()) continue;
    // Report EVERY line that matches, not just the first. One file often carries the same stale
    // claim in two places, and fixing the reported one only to fail again is a poor experience.
    lines.forEach((line, i) => {
      if (!new RegExp(claim.pattern.source, claim.pattern.flags).test(line)) return;
      const n = i + 1;
      if (exempt.some((e) => e.id === claim.id && n >= e.from && n <= e.to)) return;
      problems.push({ file: relative(ROOT, file), line: n, text: line.trim().slice(0, 72), claim });
    });
  }
}

if (problems.length) {
  console.error(`\n  claims-check: ${problems.length} unsupportable claim(s) in user-facing copy\n`);
  for (const p of problems) {
    console.error(`    ✗ ${p.file}:${p.line}  [${p.claim.id}]`);
    console.error(`        ${p.text}`);
    console.error(`        ${p.claim.why}`);
    console.error(`        ${p.claim.fix}\n`);
  }
  console.error('  Change the copy, or change the system so the copy is true.\n');
  process.exit(1);
}
console.log(`  claims-check: ${files.length} files, ${CLAIMS.length} claims, nothing unsupportable`);
