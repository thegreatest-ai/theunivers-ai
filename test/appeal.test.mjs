/**
 * Author-facing appeal of a limited comment.
 *
 * Hidden Words hid the comment and left the author with nothing to press. The product's claim
 * is the record: a filter hit writes a receipt, the author can contest it, the contest is a
 * forward append, and it lands on the existing operator queue. There is no panel.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODERATION_ACTIONS, AVAILABLE_ACTIONS, moderationSentence } from '../shared/moderation-actions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'operator-token-for-the-appeal-test';
const TOK = { ana: 'tok_ap_ana', ben: 'tok_ap_ben', operator: TOKEN };
const SLUR = 'nigger';

const SERVER = readFileSync(join(ROOT, 'server', 'index.mjs'), 'utf8');
const YOU = readFileSync(join(ROOT, 'src', 'app', 'You.jsx'), 'utf8');
const DETAIL = readFileSync(join(ROOT, 'src', 'app', 'WorkDetail.jsx'), 'utf8');
const CONTEST = readFileSync(join(ROOT, 'src', 'app', 'Contest.jsx'), 'utf8');

function routeBody(method, path) {
  const start = SERVER.indexOf(`route('${method}', '${path}'`);
  assert.notEqual(start, -1, `${method} ${path} is not registered`);
  const next = SERVER.indexOf("\nroute('", start + 1);
  return SERVER.slice(start, next === -1 ? SERVER.length : next);
}

test('appeal is not a report-resolution action, and the sentence does not invent a panel', () => {
  assert.deepEqual(AVAILABLE_ACTIONS.sort(), ['dismiss', 'limit', 'takedown']);
  assert.equal(MODERATION_ACTIONS.appeal.rung, null);
  assert.match(MODERATION_ACTIONS.appeal.sentence, /There is no panel/);
  assert.equal(
    moderationSentence('moderation.limited', { source: 'filter' }),
    'A filter hid this from other people. It is retained in full.',
  );
  assert.match(
    moderationSentence('moderation.limited', { source: 'operator-token' }),
    /operator/,
  );
});

test('the contest lives on the author path, not an operator desk in /app', () => {
  const appeal = routeBody('POST', '/api/comments/:id/appeal');
  assert.match(appeal, /sign in required/, 'an agent token is not the person the limit happened to');
  assert.match(appeal, /already contested/);
  assert.match(appeal, /moderation\.appealed|MODERATION_ACTIONS\.appeal/);

  assert.match(YOU, /Contest/);
  assert.match(YOU, /There is no panel/);
  assert.match(DETAIL, /Only you can see this/);
  assert.doesNotMatch(DETAIL, /comments\.filter\(/);
  assert.doesNotMatch(CONTEST, /moderation (?:team|panel)|review(?:er)? panel/i);
  assert.doesNotMatch(YOU, /\/app\/moderation/);
  assert.doesNotMatch(SERVER, /route\('GET', '\/app\/moderation/);
});

let PORT; let child; let DB;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function api(path, { method = 'GET', as, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const bearer = token || (as ? TOK[as] : undefined);
    const req = request({
      host: '127.0.0.1', port: PORT, path, method, agent: false,
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, text });
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

describe('the author can contest a filter hit', () => {
  before(async () => {
    PORT = await freePort();
    DB = join(mkdtempSync(join(tmpdir(), 'appeal-')), 'appeal.db');
    child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      env: {
        ...process.env, PORT: String(PORT), DB_PATH: DB, INVITE_CODE: 'appeal-test',
        OAUTH_STATE_SECRET: 'appeal-secret', METRICS_TOKEN: TOKEN,
        OPERATOR_NAME: 'Mohamed',
      },
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
      db.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)')
        .run(TOK[who], `usr_${who}`, t);
    }
    db.prepare('INSERT INTO agent (id,user_id,name,purpose,api_token,created_at) VALUES (?,?,?,?,?,?)')
      .run('agt_ben', 'usr_ben', 'ben.appeals', 'acts', 'tok_agent_ap_ben', t);
    db.close();
  });

  after(() => child?.kill());

  async function anaWork() {
    const r = await api('/api/works', {
      method: 'POST', as: 'ana',
      body: { kind: 'thread', title: 'a work', body: 'the body' },
    });
    assert.equal(r.status, 200, r.text);
    return r.json.work;
  }

  async function hiddenComment() {
    const w = await anaWork();
    const posted = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: `a ${SLUR}` },
    });
    assert.equal(posted.status, 200, posted.text);
    return { work: w, id: posted.json.comment.id };
  }

  test('POST of a hit is still silent, and GET names the operator only to the author', async () => {
    const { work, id } = await hiddenComment();
    const postedShape = await api(`/api/works/${work.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'plain words' },
    });
    assert.equal(postedShape.json.comment.hidden, undefined);
    assert.equal(postedShape.json.comment.operator, undefined);

    const mine = await api(`/api/works/${work.id}/comments`, { as: 'ben' });
    const own = mine.json.comments.find((c) => c.id === id);
    assert.equal(own.hidden, true);
    assert.equal(own.operator, 'Mohamed',
      'the name is owed on the appeal path when OPERATOR_NAME is set');

    const theirs = await api(`/api/works/${work.id}/comments`, { as: 'ana' });
    assert.equal(theirs.json.comments.filter((c) => c.id === id).length, 0);
    assert.ok(theirs.json.comments.every((c) => c.hidden === undefined && c.operator === undefined));
  });

  test('the author may contest; a second contest is 409; the hide receipt is not edited', async () => {
    const { id } = await hiddenComment();
    const empty = await api(`/api/comments/${id}/appeal`, {
      method: 'POST', as: 'ben', body: { body: '   ' },
    });
    assert.equal(empty.status, 400);

    const ok = await api(`/api/comments/${id}/appeal`, {
      method: 'POST', as: 'ben',
      body: { body: 'it was a citation, not abuse' },
    });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.appealed, true);
    assert.ok(ok.json.receipt);

    const [row] = rows('SELECT hidden_at, appealed_at, appeal_body FROM comment WHERE id = ?', id);
    assert.ok(row.hidden_at, 'contesting does not un-hide; release does');
    assert.ok(row.appealed_at);
    assert.equal(row.appeal_body, 'it was a citation, not abuse');

    const limited = rows(
      "SELECT id, payload FROM receipt WHERE type = 'moderation.limited' AND payload LIKE ?",
      `%${id}%`);
    assert.equal(limited.length, 1, 'the hide stays; a rewrite of the old link is not a record');

    const [appealed] = rows(
      "SELECT user_id, payload FROM receipt WHERE type = 'moderation.appealed' AND payload LIKE ?",
      `%${id}%`);
    assert.ok(appealed);
    assert.equal(appealed.user_id, 'usr_ben');
    const payload = JSON.parse(appealed.payload);
    assert.equal(payload.source, 'author');
    assert.equal(payload.operator, 'Mohamed');
    assert.equal(payload.body, undefined);
    assert.ok(!JSON.stringify(payload).includes('citation'));

    const again = await api(`/api/comments/${id}/appeal`, {
      method: 'POST', as: 'ben', body: { body: 'please look again' },
    });
    assert.equal(again.status, 409);

    const mine = await api(`/api/works/${(JSON.parse(limited[0].payload)).work}/comments`, { as: 'ben' });
    const own = mine.json.comments.find((c) => c.id === id);
    assert.equal(own.appealed, true);
  });

  test('a non-author cannot contest a hidden comment, and an agent token cannot either', async () => {
    const { work, id } = await hiddenComment();
    const stranger = await api(`/api/comments/${id}/appeal`, {
      method: 'POST', as: 'ana', body: { body: 'I am the work owner' },
    });
    assert.equal(stranger.status, 404, 'a hidden comment of someone else is not a thing they may know exists');

    const agent = await api(`/api/comments/${id}/appeal`, {
      method: 'POST', token: 'tok_agent_ap_ben', body: { body: 'the agent speaking' },
    });
    assert.equal(agent.status, 401);

    const clean = await api(`/api/works/${work.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'a clean remark' },
    });
    const onClean = await api(`/api/comments/${clean.json.comment.id}/appeal`, {
      method: 'POST', as: 'ben', body: { body: 'nothing happened' },
    });
    assert.equal(onClean.status, 409);

    const missing = await api('/api/comments/cmt_nope/appeal', {
      method: 'POST', as: 'ben', body: { body: 'ghost' },
    });
    assert.equal(missing.status, 404);
  });

  test('the queue surfaces the appeal first, and release still appends restored', async () => {
    const first = await hiddenComment();
    const second = await hiddenComment();
    await api(`/api/comments/${second.id}/appeal`, {
      method: 'POST', as: 'ben', body: { body: 'look at this one first' },
    });

    const queue = await api('/api/moderation/queue', { as: 'operator' });
    assert.equal(queue.status, 200);
    const appealed = queue.json.hidden.find((c) => c.id === second.id);
    const waiting = queue.json.hidden.find((c) => c.id === first.id);
    assert.ok(appealed.appealedAt);
    assert.equal(appealed.appealBody, 'look at this one first');
    assert.equal(waiting.appealedAt, null);
    const ids = queue.json.hidden.map((c) => c.id);
    assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id),
      'an appeal that sits under uncontested hits is an appeal nobody will see');

    const released = await api('/api/moderation/release', {
      method: 'POST', as: 'operator',
      body: { comment: second.id, reason: 'false positive' },
    });
    assert.equal(released.status, 200, released.text);
    const [row] = rows('SELECT hidden_at, appealed_at FROM comment WHERE id = ?', second.id);
    assert.equal(row.hidden_at, null);
    assert.ok(row.appealed_at, 'the contest happened; clearing the hide does not rewrite it');

    const restored = rows(
      "SELECT payload FROM receipt WHERE type = 'moderation.restored' AND payload LIKE ?",
      `%${second.id}%`);
    assert.equal(restored.length, 1);
    assert.equal(JSON.parse(restored[0].payload).operator, 'Mohamed');
  });
});
