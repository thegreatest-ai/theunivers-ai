/**
 * The write side of the moderation queue.
 *
 * The queue could be read and not acted on: `report.status` has had `actioned` and `dismissed` in
 * its CHECK constraint since the table was written, and nothing wrote either. So a report went
 * into a list nobody could clear.
 *
 * Two properties are worth more than the rest here. TAKEDOWN IS NOT A DELETE — a cited post must
 * survive as a tombstone, because citations are the citer's record and destroying them to act
 * against an author erases a third party's evidence. And IT IS ONE-WAY — the body is gone, so what
 * an appeal argues against is the hash taken before it was emptied, not a copy we kept.
 *
 * The cited-post-survives assertion belongs to openclaw's pass in safety.test.mjs; this file covers
 * the route.
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
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'operator-token-for-the-moderation-test';
const TITLE = 'a title that will be removed';
const BODY = 'a body that will be removed';

let PORT; let child; let DB;
const TOK = { ana: 'tok_m_ana', ben: 'tok_m_ben' };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function api(path, { method = 'GET', as, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request({
      host: '127.0.0.1', port: PORT, path, method, agent: false,
      headers: {
        ...(as ? { Authorization: `Bearer ${TOK[as]}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
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
    if (payload) req.write(payload);
    req.end();
  });
}

const rows = (sql, ...params) => {
  const db = new DatabaseSync(DB);
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
};

before(async () => {
  PORT = await freePort();
  DB = join(mkdtempSync(join(tmpdir(), 'moderation-')), 'moderation.db');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, INVITE_CODE: 'moderation-test',
           OAUTH_STATE_SECRET: 'moderation-secret', METRICS_TOKEN: TOKEN },
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

  const db = new DatabaseSync(DB);
  const t = new Date().toISOString();
  for (const who of ['ana', 'ben']) {
    db.prepare('INSERT INTO user (id,email,name,created_at) VALUES (?,?,?,?)')
      .run(`usr_${who}`, `${who}@example.test`, who, t);
    db.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)').run(TOK[who], `usr_${who}`, t);
    db.prepare('INSERT INTO agent (id,user_id,name,purpose,api_token,created_at) VALUES (?,?,?,?,?,?)')
      .run(`agt_${who}`, `usr_${who}`, `${who}.mod`, 'acts', `tok_agent_m_${who}`, t);
  }
  db.prepare(`INSERT INTO post (id,agent_id,user_id,type,lane,title,body,created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run('pst_target', 'agt_ana', 'usr_ana', 'result', 'produce', TITLE, BODY, t);
  db.close();
});

after(() => child?.kill());

describe('resolving a report', () => {
  let reportId;

  test('a report exists to resolve', async () => {
    const r = await api('/api/report', {
      method: 'POST', as: 'ben',
      body: { kind: 'post', subject: 'pst_target', reason: 'spam', detail: 'unsolicited' },
    });
    assert.equal(r.status, 200);
    reportId = rows("SELECT id FROM report WHERE subject_id = 'pst_target'")[0].id;
    assert.ok(reportId);
  });

  test('it is closed without the operator token, and to an ordinary session', async () => {
    assert.equal((await api('/api/moderation/resolve', {
      method: 'POST', body: { report: reportId, action: 'dismiss', reason: 'no' },
    })).status, 401);
    assert.equal((await api('/api/moderation/resolve', {
      method: 'POST', as: 'ben', body: { report: reportId, action: 'dismiss', reason: 'no' },
    })).status, 401, 'a signed-in person is not an operator — that is not decided in a schema');
  });

  test('an agent token is not an operator token', async () => {
    // An agent acts for a person under a mandate. No mandate carries the authority to moderate the
    // platform, so the agent surface must not reach this route at all — not even to be told why.
    const r = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ report: reportId, action: 'takedown', reason: 'x' });
      const req = request({
        host: '127.0.0.1', port: PORT, path: '/api/moderation/resolve', method: 'POST', agent: false,
        headers: {
          Authorization: 'Bearer tok_agent_m_ben',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    assert.equal(r.status, 401);
  });

  test('a decision without a stated reason is refused', async () => {
    const r = await api('/api/moderation/resolve', {
      method: 'POST', body: { token: TOKEN, report: reportId, action: 'takedown', reason: '  ' },
    });
    assert.equal(r.status, 400, 'an unappealable decision is the thing this product is not');
  });

  test('taking it down leaves a tombstone that says an OPERATOR did it', async () => {
    const r = await api('/api/moderation/resolve', {
      method: 'POST',
      body: { token: TOKEN, report: reportId, action: 'takedown', reason: 'off-platform spam' },
    });
    assert.equal(r.status, 200);

    const seen = await api('/api/posts/pst_target', { as: 'ben' });
    assert.equal(seen.status, 200, 'a tombstone, never a 404 — 404 says the source never existed');
    assert.equal(seen.json.post.withdrawn, true);
    assert.equal(seen.json.post.takenDown, true);
    assert.equal(seen.json.post.removedBy, 'operator',
      'an author withdrawing and an operator removing are different facts');
  });

  test('the hash is of what was removed, taken before the row was emptied', async () => {
    const post = rows("SELECT title, body, body_sha256 FROM post WHERE id = 'pst_target'")[0];
    assert.equal(post.title, '', 'the content is gone, not hidden behind a flag');
    assert.equal(post.body, '');
    assert.equal(post.body_sha256,
      createHash('sha256').update(`${TITLE}\n\n${BODY}`).digest('hex'),
      'an author who kept their copy must be able to prove what was taken down');
  });

  test('the author\'s chain records it as an observation, not a verdict', async () => {
    const [receipt] = rows(
      "SELECT type, user_id, payload FROM receipt WHERE type = 'moderation.takedown'");
    assert.ok(receipt, 'a moderation act with no receipt is the hole withdraw still has');
    assert.equal(receipt.user_id, 'usr_ana', 'it happened to the author; it is their record');
    const payload = JSON.parse(receipt.payload);
    assert.equal(payload.source, 'operator-token',
      'there is no signing key in this system — the provenance must not claim one');
    assert.equal(payload.report, reportId);
    assert.ok(payload.bodySha256);
  });

  test('the report moves to actioned and cannot be resolved twice', async () => {
    const report = rows('SELECT status, outcome, reviewed_by FROM report WHERE id = ?', reportId)[0];
    assert.equal(report.status, 'actioned');
    assert.equal(report.outcome, 'off-platform spam');
    assert.equal(report.reviewed_by, null,
      'no operator user row exists yet — leave the FK null rather than invent a reviewer');

    const again = await api('/api/moderation/resolve', {
      method: 'POST', body: { token: TOKEN, report: reportId, action: 'takedown', reason: 'again' },
    });
    assert.equal(again.status, 409);
  });

  test('it is gone from the queue, and gone from the feed', async () => {
    const queue = await api(`/api/moderation/queue?token=${encodeURIComponent(TOKEN)}`);
    assert.equal(queue.json.reports.filter((x) => x.subject === 'pst_target').length, 0);

    const feed = await api('/api/feed', { as: 'ben' });
    assert.equal(feed.json.posts.filter((p) => p.id === 'pst_target').length, 0,
      'one visibility predicate hides it — a second column would mean auditing every read path');
  });

  test('there is no un-takedown', async () => {
    for (const action of ['restore', 'untakedown', 'reinstate']) {
      const r = await api('/api/moderation/resolve', {
        method: 'POST', body: { token: TOKEN, report: reportId, action, reason: 'mistake' },
      });
      assert.equal(r.status, 400,
        'a restore would mean keeping the payload we just removed; the author republishes instead');
    }
  });
});
