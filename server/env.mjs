/**
 * Loads .env into process.env, and does it before anything else can read the environment.
 *
 * WHY THIS IS A MODULE AND NOT FIVE LINES IN index.mjs. It was those five lines, in the body of
 * index.mjs, and it did not work. ES module imports are hoisted and evaluated before any statement
 * in the importing file, so by the time the loader ran, every imported module had already been
 * fully evaluated — including the ones that read process.env at module scope to build a constant.
 * db.mjs opened `./data/pilot.db` while a DB_PATH sat in .env being ignored, and the operator got
 * no error, no warning, and the wrong database. Anything set BOTH in the real environment and in
 * .env looked fine, which is why it survived so long: on Fly every variable is a real secret, so
 * the bug is invisible in production and only bites a developer pointing a local run somewhere.
 *
 * As a module with the load in its body, it is evaluated when it is imported. Import it FIRST in
 * an entry point and the file is parsed before any sibling import runs. That ordering is
 * load-bearing: move the import down the list and the bug comes straight back, silently.
 *
 * ENV_FILE names a different file, which is how the regression test proves this without touching
 * the repo's real .env.
 *
 * A VALUE MAY BE A REFERENCE RATHER THAN A SECRET — see KEYCHAIN below.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * The Keychain account every secret in this project is filed under. It MUST match `ACCOUNT` in
 * `scripts/set-secret.mjs`: that script is the write side, this is the read side, and a project
 * that stores under one account and reads from another has a secret store nobody can use.
 */
export const KEYCHAIN_ACCOUNT = 'theunivers-ai';

/** `KEY=keychain:SERVICE` — the file names where the secret is, and never what it is. */
const KEYCHAIN_REF = /^keychain:(.+)$/;

/**
 * Reads one secret out of the macOS login Keychain.
 *
 * `-w` prints the value on stdout, so it never becomes a command-line argument and never appears
 * in the process list — the same reason `set-secret.mjs` hands values to Fly over stdin. stderr is
 * discarded rather than surfaced: it is the one channel `security` will happily print the item's
 * attributes on, and this runs at boot on a developer's terminal.
 *
 * The timeout exists because a Keychain that cannot answer without a GUI prompt would otherwise
 * hang the server's import — a boot that never finishes and never says why. Ten seconds is long
 * enough to click "Always Allow" and short enough to be a failure rather than a hang. Losing that
 * race is not fatal: the variable is left unset and the warning names the fix.
 */
function readKeychain(service) {
  if (process.platform !== 'darwin') return null;
  const r = spawnSync('security', ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', service, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
  return r.status === 0 && r.stdout ? r.stdout.trim() : null;
}

/** Where the file is read from. ENV_FILE must come from the real environment, not from .env. */
export const envFile = process.env.ENV_FILE ?? join(ROOT, '.env');

/**
 * `KEY=value`, one per line; blank lines and `#` comments ignored, surrounding whitespace trimmed.
 * Deliberately not a dotenv implementation — no quote stripping, no interpolation, no multi-line
 * values — because the file it parses is ours and every value in it is a single flat token.
 * Exported so the precedence rule can be tested without a filesystem.
 */
export function parseEnv(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * Applies the file to process.env and returns the names it actually set.
 *
 * A variable already present in the environment always wins — .env is the fallback for a developer
 * machine, never an override of what a deploy configured. The emptiness test is `!value` rather
 * than a check for undefined because that is what the original loader did, and this change is
 * about WHEN the load happens, not what it decides.
 *
 * ─── KEYCHAIN REFERENCES ─────────────────────────────────────────────────────────────────
 *
 * `GOOGLE_CLIENT_SECRET=keychain:GOOGLE_CLIENT_SECRET` means "the value is in the Keychain under
 * that name". SECRETS-POLICY.md is Keychain-first, and this project already had the write half —
 * `npm run secret` stores to the Keychain and pushes to Fly, and prints "Not written to .env".
 * Nothing could READ it back, so a developer who needed the value locally had one option left:
 * paste it into .env. The policy was followed and the plaintext appeared anyway.
 *
 * Production never takes this path. On Fly every variable is a real environment variable, there is
 * no .env in the image, and `security` does not exist on Linux — which is also why an unresolvable
 * reference is a WARNING rather than a thrown error: the failure is local, and killing the boot of
 * a dev server is a worse answer than starting it with Google sign-in visibly off.
 *
 * THE ONE INVARIANT: an unresolved reference sets NOTHING. Assigning the literal `keychain:NAME`
 * would hand the app a string that is definitely not the secret, and it would fail somewhere far
 * away — a rejected OAuth exchange, a signature that never verifies — with the reason nowhere near
 * the symptom. Unset is a state the app already handles honestly: `/api/auth/providers` reports
 * the provider off, and `/api/metrics` 404s. Wrong is a state nothing handles.
 */
export function loadEnv(file = envFile, read = readKeychain) {
  if (!existsSync(file)) return [];
  const applied = [];
  for (const [key, raw] of parseEnv(readFileSync(file, 'utf8'))) {
    if (process.env[key]) continue;
    const ref = KEYCHAIN_REF.exec(raw);
    const value = ref ? read(ref[1]) : raw;
    if (ref && !value) {
      // Names the variable, the item and the fix. Never the value — there isn't one.
      console.warn(`[env] ${key}: no Keychain item "${ref[1]}" for account "${KEYCHAIN_ACCOUNT}" `
        + `— leaving it unset. Store it with: npm run secret ${key}`);
      continue;
    }
    process.env[key] = value;
    applied.push(key);
  }
  return applied;
}

loadEnv();
