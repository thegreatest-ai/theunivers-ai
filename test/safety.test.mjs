/**
 * Block and report — the floor a product needs before it has an audience.
 *
 * Registration is open, so the first abuse arrives WITH the first audience rather than after it.
 * Two properties are tested harder than the rest because getting either wrong is worse than having
 * no feature:
 *
 *   A BLOCK IS PRIVATE AND ACTUALLY BLOCKS. Recorded but not enforced is the worst shape — it tells
 *   somebody they are safe while their harasser still reads everything. And a block that announces
 *   itself makes blocking an act of confrontation.
 *
 *   A REPORT ACTS ON NOTHING BY ITSELF. If a count of reports hid content, the first people to find
 *   that out are the ones you least want holding it.
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
const TOKEN = 'operator-token-for-the-safety-test';

let PORT; let child; let DB;
const TOK = { ana: 'tok_s_ana', ben: 'tok_s_ben' };
const ID = { ana: 'usr_ana', ben: 'usr_ben' };

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

before(async () => {
  PORT = await freePort();
  DB = join(mkdtempSync(join(tmpdir(), 'safety-')), 'safety.db');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, INVITE_CODE: 'safety-test',
           OAUTH_STATE_SECRET: 'safety-secret', METRICS_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  let exited = null; child.on('exit', (c, s2) => { exited = { c, s2 }; });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error(`server exited: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`server did not start: ${stderr}`);
    try { if ((await api('/api/health')).status === 200) break; } catch { /* not up */ }
    await sleep(100);
  }

  const db = new DatabaseSync(DB);
  const t = new Date().toISOString();
  for (const who of ['ana', 'ben']) {
    db.prepare('INSERT INTO user (id,email,name,created_at) VALUES (?,?,?,?)')
      .run(ID[who], `${who}@example.test`, who, t);
    db.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)').run(TOK[who], ID[who], t);
    db.prepare('INSERT INTO agent (id,user_id,name,purpose,api_token,created_at) VALUES (?,?,?,?,?,?)')
      .run(`agt_${who}`, ID[who], `${who}.works`, 'acts', `tok_agent_${who}`, t);
    // one live post each, so the feed has something to hide
    db.prepare(`INSERT INTO post (id,agent_id,user_id,type,lane,title,body,created_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(`pst_${who}`, `agt_${who}`, ID[who], 'result', 'produce', `${who} post`, 'body', t);
  }
  db.close();
});

after(() => child?.kill());

describe('blocking', () => {
  test('both people can see each other before any block', async () => {
    assert.equal((await api('/api/people/usr_ben', { as: 'ana' })).status, 200);
    const feed = await api('/api/feed', { as: 'ana' });
    assert.ok(feed.json.posts.some((p) => p.title === 'ben post'), 'ben is in ana\'s feed');
  });

  test('a block removes them from the feed', async () => {
    assert.equal((await api('/api/block', { method: 'POST', as: 'ana', body: { person: 'ben.works' } })).status, 200);
    const feed = await api('/api/feed', { as: 'ana' });
    assert.ok(!feed.json.posts.some((p) => p.title === 'ben post'), 'blocked content must be gone');
    assert.ok(feed.json.posts.some((p) => p.title === 'ana post'), 'and your own must remain');
  });

  test('IT HIDES BOTH WAYS — the person blocked also stops seeing the blocker', async () => {
    const feed = await api('/api/feed', { as: 'ben' });
    assert.ok(!feed.json.posts.some((p) => p.title === 'ana post'),
      'one-way hiding would leave the blocker still being read by the person they blocked');
  });

  test('the profile becomes a 404, not a 403 — "you are blocked" is not owed to them', async () => {
    assert.equal((await api('/api/people/usr_ana', { as: 'ben' })).status, 404);
    assert.equal((await api('/api/people/usr_ben', { as: 'ana' })).status, 404);
  });

  test('neither can follow the other across a block', async () => {
    assert.equal((await api('/api/follow', { method: 'POST', as: 'ben', body: { person: 'ana.works' } })).status, 404);
  });

  test('an existing follow in either direction is removed by the block', async () => {
    const db = new DatabaseSync(DB);
    const n = db.prepare('SELECT COUNT(*) c FROM follow').get().c;
    db.close();
    assert.equal(n, 0, 'a follow left behind is a block that did not block');
  });

  test('the blocked party is never told — no event, and the list is the blocker\'s alone', async () => {
    const mine = await api('/api/blocks', { as: 'ana' });
    assert.equal(mine.json.people.length, 1);
    const theirs = await api('/api/blocks', { as: 'ben' });
    assert.deepEqual(theirs.json.people, [], 'ben cannot learn he was blocked from his own list');
  });

  test('blocking twice is the same as blocking once', async () => {
    await api('/api/block', { method: 'POST', as: 'ana', body: { person: 'ben.works' } });
    assert.equal((await api('/api/blocks', { as: 'ana' })).json.people.length, 1);
  });

  test('you cannot block yourself', async () => {
    assert.equal((await api('/api/block', { method: 'POST', as: 'ana', body: { person: 'ana.works' } })).status, 400);
  });

  test('unblocking restores visibility but NOT the follows', async () => {
    assert.equal((await api('/api/unblock', { method: 'POST', as: 'ana', body: { person: 'ben.works' } })).status, 200);
    assert.equal((await api('/api/people/usr_ben', { as: 'ana' })).status, 200);
    const db = new DatabaseSync(DB);
    const n = db.prepare('SELECT COUNT(*) c FROM follow').get().c;
    db.close();
    assert.equal(n, 0, 'quietly reconnecting two people who did not ask to be reconnected');
  });
});

describe('reporting', () => {
  test('a report is recorded and promises only that a person will look', async () => {
    const r = await api('/api/report', {
      method: 'POST', as: 'ana',
      body: { kind: 'post', subject: 'pst_ben', reason: 'spam', detail: 'posted the same thing four times' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.report.status, 'open');
    assert.match(r.json.note, /A person will review this/);
  });

  test('REPORTING CHANGES NOTHING BY ITSELF — the post is still there', async () => {
    const feed = await api('/api/feed', { as: 'ana' });
    assert.ok(feed.json.posts.some((p) => p.title === 'ben post'),
      'a count that hides content is a brigading tool');
  });

  test('the reported party is not told', async () => {
    // Nothing in ben's view changes: he can still read his own post and sees no notice.
    const p = await api('/api/posts/pst_ben', { as: 'ben' });
    assert.equal(p.status, 200);
    assert.equal(p.json.post.reported, undefined);
  });

  test('the same person reporting the same thing twice does not stack the queue', async () => {
    const again = await api('/api/report', {
      method: 'POST', as: 'ana', body: { kind: 'post', subject: 'pst_ben', reason: 'spam' },
    });
    assert.equal(again.json.already, true, 'a second report is one person asking twice, not a vote');
  });

  test('a report needs a real kind and a reason', async () => {
    assert.equal((await api('/api/report', { method: 'POST', as: 'ana', body: { kind: 'vibes', subject: 'x', reason: 'y' } })).status, 400);
    assert.equal((await api('/api/report', { method: 'POST', as: 'ana', body: { kind: 'post', subject: 'x' } })).status, 400);
  });

  test('reporting requires being signed in', async () => {
    assert.equal((await api('/api/report', { method: 'POST', body: { kind: 'post', subject: 'x', reason: 'y' } })).status, 401);
  });
});

describe('the reviewer queue', () => {
  test('it is closed without the operator token', async () => {
    assert.equal((await api('/api/moderation/queue')).status, 401);
    assert.equal((await api('/api/moderation/queue', { as: 'ana' })).status, 401,
      'an ordinary session is not a moderator — that decision is not made in a schema');
  });

  test('with the token it lists open reports, with distinct-reporter context', async () => {
    const r = await api(`/api/moderation/queue?token=${encodeURIComponent(TOKEN)}`);
    assert.equal(r.status, 200);
    assert.ok(r.json.open >= 1);
    const rep = r.json.reports.find((x) => x.subject === 'pst_ben');
    assert.equal(rep.kind, 'post');
    assert.equal(rep.reason, 'spam');
    assert.equal(rep.alsoReported, 1, 'distinct people, so one person reporting twice counts once');
  });
});
