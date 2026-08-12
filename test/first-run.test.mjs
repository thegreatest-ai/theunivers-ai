/**
 * The first five minutes — ADR-0005 item 3.
 *
 * A signup becomes a user when they deploy an agent, state a mandate in their own words, and **see
 * it refuse something**. The refusal is the product; a first run that never shows one has
 * demonstrated a form, not a guarantee.
 *
 * The property under test throughout: **every step is DERIVED from the rows that would exist if it
 * had happened.** A stored `onboarding_step` disagrees with reality the first time somebody deletes
 * their agent, and then the interface argues with the database. In particular `refusalSeen` reads
 * the guard's own record — not a flag set when a screen was shown, because the claim is "your agent
 * was actually stopped" and only `mandate_audit` supports it.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let PORT; let child; let DB;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function api(path, { as = 'tok_first_run' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1', port: PORT, path, method: 'GET', agent: false,
      headers: { Authorization: `Bearer ${as}` },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const now = () => new Date().toISOString();
const db = () => new DatabaseSync(DB);

before(async () => {
  PORT = await freePort();
  DB = join(mkdtempSync(join(tmpdir(), 'firstrun-')), 'fr.db');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, INVITE_CODE: 'fr-test',
           OAUTH_STATE_SECRET: 'fr-secret' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  let exited = null; child.on('exit', (c) => { exited = c; });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited !== null) throw new Error(`server exited: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`server did not start: ${stderr}`);
    try { if ((await api('/api/health')).status === 200) break; } catch { /* not up */ }
    await sleep(100);
  }

  const d = db();
  d.prepare('INSERT INTO user (id,email,name,created_at) VALUES (?,?,?,?)')
    .run('usr_fr', 'fr@example.test', 'New person', now());
  d.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)')
    .run('tok_first_run', 'usr_fr', now());
  d.close();
});

after(() => child?.kill());

describe('a brand new account', () => {
  test('has three steps, none of them done', async () => {
    const r = await api('/api/me');
    assert.equal(r.status, 200);
    const fr = r.json.firstRun;
    assert.deepEqual(fr.steps.map((s) => s.id), ['agent', 'mandate', 'refusal']);
    assert.deepEqual(fr.steps.map((s) => s.done), [false, false, false]);
    assert.equal(fr.done, false);
    assert.equal(fr.lastRefusal, null);
  });

  test('every step says WHY, not just what', async () => {
    for (const s of (await api('/api/me')).json.firstRun.steps) {
      assert.ok(s.title?.length > 5, `${s.id} needs a title`);
      assert.ok(s.why?.length > 20, `${s.id} must say why it matters, or it is a checklist`);
    }
  });
});

describe('the steps are derived, not stored', () => {
  test('deploying an agent completes the first step and nothing else', async () => {
    const d = db();
    d.prepare(`INSERT INTO agent (id,user_id,name,purpose,api_token,created_at)
               VALUES (?,?,?,?,?,?)`)
      .run('agt_fr', 'usr_fr', 'newperson.trading', 'acts for me', 'tok_agent_fr', now());
    d.close();

    const fr = (await api('/api/me')).json.firstRun;
    assert.deepEqual(fr.steps.map((s) => s.done), [true, false, false]);
  });

  test('an active mandate completes the second', async () => {
    const d = db();
    d.prepare(`INSERT INTO mandate (id,agent_id,commodity,scope,price_floor,created_at)
               VALUES (?,?,?,?,?,?)`)
      .run('mnd_fr', 'agt_fr', 'red onion', 'negotiate', 12, now());
    d.close();

    const fr = (await api('/api/me')).json.firstRun;
    assert.deepEqual(fr.steps.map((s) => s.done), [true, true, false]);
    assert.equal(fr.done, false, 'a mandate without a refusal has not shown the person anything');
  });

  test('A SUPERSEDED MANDATE DOES NOT COUNT — the step reflects what is true now', async () => {
    const d = db();
    d.prepare("UPDATE mandate SET status = 'superseded' WHERE id = 'mnd_fr'").run();
    d.close();
    const fr = (await api('/api/me')).json.firstRun;
    assert.equal(fr.steps[1].done, false, 'a stored step would still say done here');

    const d2 = db();
    d2.prepare("UPDATE mandate SET status = 'active' WHERE id = 'mnd_fr'").run();
    d2.close();
  });

  test('an ALLOWED guard decision is not a refusal', async () => {
    const d = db();
    d.prepare(`INSERT INTO mandate_audit (id,agent_id,intent,allowed,code,reason,created_at)
               VALUES (?,?,?,?,?,?,?)`)
      .run('aud_ok', 'agt_fr', '{}', 1, null, null, now());
    d.close();

    const fr = (await api('/api/me')).json.firstRun;
    assert.equal(fr.steps[2].done, false, 'the guard saying yes proves nothing about limits');
    assert.equal(fr.lastRefusal, null);
  });

  test('a RECORDED refusal completes the last step, and is returned in full', async () => {
    const d = db();
    d.prepare(`INSERT INTO mandate_audit (id,agent_id,intent,allowed,code,reason,created_at)
               VALUES (?,?,?,?,?,?,?)`)
      .run('aud_no', 'agt_fr', '{}', 0, 'FLOOR', 'Refused by your mandate: below floor', now());
    d.close();

    const fr = (await api('/api/me')).json.firstRun;
    assert.deepEqual(fr.steps.map((s) => s.done), [true, true, true]);
    assert.equal(fr.done, true);
    assert.equal(fr.lastRefusal.code, 'FLOOR');
    assert.match(fr.lastRefusal.reason, /below floor/,
      'the interface must show WHAT was stopped, not assert that something was');
  });

  test('deleting the agent undoes all three — a stored flag could not', async () => {
    const d = db();
    d.prepare("DELETE FROM mandate_audit WHERE agent_id = 'agt_fr'").run();
    d.prepare("DELETE FROM mandate WHERE agent_id = 'agt_fr'").run();
    d.prepare("DELETE FROM agent WHERE id = 'agt_fr'").run();
    d.close();

    const fr = (await api('/api/me')).json.firstRun;
    assert.deepEqual(fr.steps.map((s) => s.done), [false, false, false]);
    assert.equal(fr.done, false);
  });
});

describe('it is nobody else\'s business', () => {
  test('firstRun is absent without a session', async () => {
    const r = await api('/api/me', { as: 'not-a-token' });
    assert.equal(r.status, 401);
    assert.equal(r.json?.firstRun, undefined);
  });
});
