/**
 * The environment must be loaded before any module reads it.
 *
 * The bug this guards against had no symptom. `.env` was parsed in the body of index.mjs, which
 * runs AFTER every import has been evaluated, so db.mjs had already frozen `./data/pilot.db` into
 * a constant. A DB_PATH set only in .env was silently ignored and the operator worked against the
 * wrong database believing otherwise.
 *
 * The unit tests below cover the precedence rule. The last one is the one that matters: it boots
 * the REAL server with DB_PATH set ONLY in a file, and asserts the database appears where the file
 * said. Nothing but correct load ordering makes that pass — which is why it is an end-to-end test
 * and not an assertion about import positions in the source.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { parseEnv, loadEnv } from '../server/env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask the OS for a port rather than guessing one; the suite runs in parallel. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

describe('parsing', () => {
  test('reads KEY=value, ignoring blanks and comments', () => {
    const got = parseEnv('A=1\n\n# a comment\nB = two \nnot a line\n');
    assert.deepEqual([...got], [['A', '1'], ['B', 'two']]);
  });

  test('an empty assignment is a key with an empty value, not a missing key', () => {
    assert.deepEqual([...parseEnv('RESEND_API_KEY=')], [['RESEND_API_KEY', '']]);
  });

  test('lowercase names are not variables', () => {
    assert.deepEqual([...parseEnv('path=/tmp\nPATH2=/tmp')], [['PATH2', '/tmp']]);
  });
});

describe('precedence', () => {
  test('the real environment wins; .env is only a fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-prec-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'ENV_TEST_SET=from-file\nENV_TEST_UNSET=from-file\n');

    process.env.ENV_TEST_SET = 'from-environment';
    delete process.env.ENV_TEST_UNSET;
    try {
      const applied = loadEnv(file);
      assert.equal(process.env.ENV_TEST_SET, 'from-environment', 'must not override a real variable');
      assert.equal(process.env.ENV_TEST_UNSET, 'from-file', 'must fill in a missing one');
      assert.deepEqual(applied, ['ENV_TEST_UNSET'], 'reports only what it set');
    } finally {
      delete process.env.ENV_TEST_SET;
      delete process.env.ENV_TEST_UNSET;
    }
  });

  test('a missing file is not an error', () => {
    assert.deepEqual(loadEnv(join(tmpdir(), 'definitely-absent-' + Date.now(), '.env')), []);
  });
});

/*
 * The regression test. DB_PATH is deliberately absent from the child's environment and present
 * only in the file, which is exactly the case that used to fail silently.
 */
test('DB_PATH set only in the env file decides where the database opens', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-order-'));
  const dbPath = join(dir, 'chosen-by-file.db');
  const port = await freePort();

  writeFileSync(join(dir, '.env'), [
    `DB_PATH=${dbPath}`,
    'INVITE_CODE=env-order-test',
    'OAUTH_STATE_SECRET=env-order-secret',
    '',
  ].join('\n'));

  // Strip DB_PATH from what the child inherits, so the file is the ONLY source of it.
  const env = { ...process.env, PORT: String(port), ENV_FILE: join(dir, '.env') };
  delete env.DB_PATH;

  const child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });

  try {
    const deadline = Date.now() + 60_000;
    let up = false;
    while (Date.now() < deadline && !up) {
      if (exited) {
        throw new Error(
          `the server exited during startup (code ${exited.code}, signal ${exited.signal})` +
          (stderr.trim() ? `:\n${stderr.trim()}` : ' with nothing on stderr'),
        );
      }
      if (existsSync(dbPath)) { up = true; break; }
      await sleep(100);
    }

    assert.ok(
      up,
      `the database was never created at ${dbPath}. The environment was loaded too late, so ` +
      `db.mjs kept its default. Files in the temp dir: ${JSON.stringify(readdirSync(dir))}` +
      (stderr.trim() ? `\nstderr:\n${stderr.trim()}` : ''),
    );
  } finally {
    child.kill();
  }
});
