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
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

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
 */
export function loadEnv(file = envFile) {
  if (!existsSync(file)) return [];
  const applied = [];
  for (const [key, value] of parseEnv(readFileSync(file, 'utf8'))) {
    if (!process.env[key]) {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

loadEnv();
