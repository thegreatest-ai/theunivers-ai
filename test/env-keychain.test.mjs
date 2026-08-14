/**
 * A .env value may name a secret instead of containing one.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────────────────
 *
 * SECRETS-POLICY.md is Keychain-first, and `scripts/set-secret.mjs` implemented half of it: it
 * stores to the Keychain, pushes to Fly, and tells you it did NOT write .env. Nothing could read
 * the value back, so local development had exactly one way to get at a secret — paste it into
 * .env — and a live Google client secret sat in a world-readable file for weeks while the policy
 * was, on paper, being followed. A rule that leaves no way to comply is a rule that gets broken.
 *
 * The tests inject the reader rather than touching the real Keychain. A test that wrote to the
 * developer's login Keychain would be a test with a side effect on the machine running it, and one
 * that read a real item would fail on any machine but this one. The single test that does exercise
 * the real `security` binary asks for an item that cannot exist, because "it returns null and does
 * not throw" is the only thing about the live path worth pinning.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv, KEYCHAIN_ACCOUNT } from '../server/env.mjs';

/** A .env in a temp directory, so nothing here can touch the repo's real one. */
function envFileWith(body) {
  const dir = mkdtempSync(join(tmpdir(), 'univ-keychain-'));
  const file = join(dir, '.env');
  writeFileSync(file, body);
  return file;
}

/** Records what was asked for, so "it did not even look" is assertable. */
function reader(items = {}) {
  const asked = [];
  const read = (service) => { asked.push(service); return items[service] ?? null; };
  read.asked = asked;
  return read;
}

/** loadEnv mutates process.env; every test cleans up the names it introduced. */
function withClean(names, fn) {
  const before = names.map((n) => [n, process.env[n]]);
  try { fn(); } finally {
    for (const [n, v] of before) {
      if (v === undefined) delete process.env[n]; else process.env[n] = v;
    }
  }
}

describe('a keychain: reference in .env', () => {
  test('resolves to the stored secret, and the reference never reaches the environment', () => {
    withClean(['UNIV_TEST_SECRET'], () => {
      delete process.env.UNIV_TEST_SECRET;
      const file = envFileWith('UNIV_TEST_SECRET=keychain:some-item\n');
      const read = reader({ 'some-item': 'the-real-value' });

      const applied = loadEnv(file, read);

      assert.equal(process.env.UNIV_TEST_SECRET, 'the-real-value');
      assert.deepEqual(applied, ['UNIV_TEST_SECRET']);
      assert.deepEqual(read.asked, ['some-item'], 'the service name is the part after the colon');
    });
  });

  test('THE INVARIANT: an unresolvable reference sets nothing at all', () => {
    withClean(['UNIV_TEST_MISSING'], () => {
      delete process.env.UNIV_TEST_MISSING;
      const file = envFileWith('UNIV_TEST_MISSING=keychain:not-there\n');

      const applied = loadEnv(file, reader());

      // The literal string is the dangerous outcome: a value that is definitely not the secret,
      // failing far from here. Unset is a state the app already reports honestly.
      assert.equal(process.env.UNIV_TEST_MISSING, undefined);
      assert.deepEqual(applied, []);
    });
  });

  test('one missing reference does not stop the rest of the file loading', () => {
    withClean(['UNIV_TEST_A', 'UNIV_TEST_B'], () => {
      delete process.env.UNIV_TEST_A; delete process.env.UNIV_TEST_B;
      const file = envFileWith('UNIV_TEST_A=keychain:absent\nUNIV_TEST_B=plain\n');

      loadEnv(file, reader());

      assert.equal(process.env.UNIV_TEST_A, undefined);
      assert.equal(process.env.UNIV_TEST_B, 'plain', 'a bad secret must not take PORT down with it');
    });
  });

  test('a plain value is untouched and costs no Keychain lookup', () => {
    withClean(['UNIV_TEST_PLAIN'], () => {
      delete process.env.UNIV_TEST_PLAIN;
      const file = envFileWith('UNIV_TEST_PLAIN=8790\n');
      const read = reader();

      loadEnv(file, read);

      assert.equal(process.env.UNIV_TEST_PLAIN, '8790');
      assert.deepEqual(read.asked, [], 'no prompt, no subprocess, for a value that is just a value');
    });
  });

  test('only an exact prefix is a reference — anything else is a literal value', () => {
    withClean(['UNIV_TEST_NEAR'], () => {
      delete process.env.UNIV_TEST_NEAR;
      const file = envFileWith('UNIV_TEST_NEAR=not-keychain:item\n');
      const read = reader({ item: 'wrong' });

      loadEnv(file, read);

      assert.equal(process.env.UNIV_TEST_NEAR, 'not-keychain:item');
      assert.deepEqual(read.asked, []);
    });
  });

  test('a real environment variable still wins, and nothing is looked up', () => {
    withClean(['UNIV_TEST_WINS'], () => {
      process.env.UNIV_TEST_WINS = 'from-the-environment';
      const file = envFileWith('UNIV_TEST_WINS=keychain:some-item\n');
      const read = reader({ 'some-item': 'from-the-keychain' });

      loadEnv(file, read);

      // Precedence is the rule this loader already had; a reference must not quietly invert it.
      // The second assertion is the point: on a deploy that sets everything, this costs nothing.
      assert.equal(process.env.UNIV_TEST_WINS, 'from-the-environment');
      assert.deepEqual(read.asked, [], 'no lookup for a variable that is already set');
    });
  });
});

describe('the real reader', () => {
  test('an item that does not exist returns null rather than throwing', { skip: process.platform !== 'darwin' && 'macOS only' }, () => {
    withClean(['UNIV_TEST_REAL'], () => {
      delete process.env.UNIV_TEST_REAL;
      const file = envFileWith('UNIV_TEST_REAL=keychain:univers-test-item-that-does-not-exist\n');

      // No injected reader: this spawns `security` for real.
      assert.doesNotThrow(() => loadEnv(file));
      assert.equal(process.env.UNIV_TEST_REAL, undefined);
    });
  });

  test('the read account matches the account set-secret.mjs writes to', async () => {
    const { readFileSync } = await import('node:fs');
    const script = readFileSync(new URL('../scripts/set-secret.mjs', import.meta.url), 'utf8');
    const m = script.match(/const ACCOUNT = '([^']+)'/);

    // Two constants in two files that must agree, with no import between them: the write side is a
    // standalone script and the read side boots the server. If they drift, `npm run secret` files
    // the key somewhere the server will never look, and the only symptom is a secret that is
    // "stored" and never found.
    assert.ok(m, 'set-secret.mjs must declare ACCOUNT');
    assert.equal(m[1], KEYCHAIN_ACCOUNT);
  });
});
