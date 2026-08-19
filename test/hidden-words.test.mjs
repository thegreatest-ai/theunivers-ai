/**
 * Hidden Words: the filter that should have shipped before comments did.
 *
 * Four properties are worth more than the rest, because getting any of them wrong is worse
 * than having no filter:
 *
 *   HIDE, NEVER DELETE. A dropped comment is evidence the filter fired that nobody can audit.
 *   THE COMMENTER STILL SEES THEIR OWN. Told it was hidden, they write it again from another
 *     account. Seeing it sitting there, they do not.
 *   WORD BOUNDARIES. Substring match is the Scunthorpe problem.
 *   FILTER IN SQL ON READ. A client-side hide is a client that can be told not to.
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
import { matches, normalise, WORDS } from '../shared/hidden-words.mjs';
import { MODERATION_ACTIONS, AVAILABLE_ACTIONS } from '../shared/moderation-actions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'operator-token-for-the-hidden-words-test';
const TOK = { ana: 'tok_hw_ana', ben: 'tok_hw_ben', operator: TOKEN };
const SLUR = 'nigger';
const LEET = 'n1gg3r';

test('the list is small and contains the Scunthorpe term, not profanity', () => {
  assert.ok(WORDS.includes('cunt'), 'the canonical substring-failure needs a listed term inside Scunthorpe');
  assert.ok(WORDS.includes(SLUR));
  assert.ok(!WORDS.includes('fuck'), 'profanity is politeness, not safety');
  assert.ok(!WORDS.includes('shit'));
  assert.ok(WORDS.length <= 20, 'start small — an over-eager list is the product looking broken');
});

test('a listed term matches, case-insensitively, after combining marks are stripped', () => {
  assert.equal(matches(`You are a ${SLUR}`), SLUR);
  assert.equal(matches(`YOU ARE A ${SLUR.toUpperCase()}`), SLUR);
  assert.equal(matches(`${SLUR}\u0301`), SLUR, 'NFD combining marks must not dodge the filter');
});

test('the Scunthorpe problem: an innocent word containing a listed term as a substring is NOT hidden', () => {
  assert.equal(matches('Scunthorpe'), null);
  assert.equal(matches('I live in Scunthorpe, North Lincolnshire'), null);
  assert.equal(matches('retardant'), null, 'word boundaries, not stems');
});

test('leetspeak folding catches an obvious evasion', () => {
  assert.equal(matches(LEET), SLUR);
  assert.equal(matches('n1gger'), SLUR);
  assert.equal(normalise(LEET), SLUR);
});

test('a clean comment is untouched', () => {
  assert.equal(matches('a thoughtful note about the work'), null);
  assert.equal(matches(''), null);
  assert.equal(matches(null), null);
});

test('release is not a report-resolution action', () => {
  // /api/moderation/restore must not exist — that is the takedown undo this ladder refuses.
  // Release is its own path, so it must not appear in the enum resolveReport accepts.
  assert.deepEqual(AVAILABLE_ACTIONS.sort(), ['dismiss', 'limit', 'takedown']);
  assert.equal(MODERATION_ACTIONS.release.receipt, 'moderation.restored');
  assert.equal(MODERATION_ACTIONS.appeal.receipt, 'moderation.appealed');
  assert.equal(MODERATION_ACTIONS.appeal.rung, null);
});

const SERVER = readFileSync(join(ROOT, 'server', 'index.mjs'), 'utf8');
const DB_SRC = readFileSync(join(ROOT, 'server', 'db.mjs'), 'utf8');
const DETAIL = readFileSync(join(ROOT, 'src', 'app', 'WorkDetail.jsx'), 'utf8');
const SETTINGS = readFileSync(join(ROOT, 'src', 'app', 'Settings.jsx'), 'utf8');

function routeBody(method, path) {
  const start = SERVER.indexOf(`route('${method}', '${path}'`);
  assert.notEqual(start, -1, `${method} ${path} is not registered`);
  const next = SERVER.indexOf("\nroute('", start + 1);
  return SERVER.slice(start, next === -1 ? SERVER.length : next);
}

test('filtering happens in SQL on read, never in the client', () => {
  const get = routeBody('GET', '/api/works/:id/comments');
  assert.match(get, /hidden_at IS NULL OR c\.user_id = \?/,
    'the list predicate must live in the SELECT, not in a later filter');
  assert.doesNotMatch(get, /rows\.filter\(/,
    'a JS filter after the query is the client-side hide with extra steps');

  const post = routeBody('POST', '/api/works/:id/comments');
  assert.match(post, /matches\(text\)/, 'the filter fires at write, and stores the hit');
  assert.match(post, /hidden_reason/, 'a dropped comment would destroy the only evidence it fired');

  assert.doesNotMatch(DETAIL, /hidden_at|hiddenAt|filterComments|matches\(/,
    'the glass must render what the API returned — filtering here is a client that can be told not to');
  assert.doesNotMatch(DETAIL, /comments\.filter\(/,
    'a client-side hide of other people\'s comments is the thing SQL already did');
  assert.match(SETTINGS, /Hide offensive comments/,
    'the switch is named for what a person wants, and it lives in Settings');
});

test('the columns exist via ensureColumn, not a parallel store', () => {
  assert.match(DB_SRC, /ensureColumn\('comment', 'hidden_at'/);
  assert.match(DB_SRC, /ensureColumn\('comment', 'hidden_reason'/);
  assert.match(DB_SRC, /ensureColumn\('comment', 'appealed_at'/);
  assert.match(DB_SRC, /ensureColumn\('user', 'filter_comments'/);
});

let PORT; let child; let DB;

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

function wire(comment) {
  // Volatile fields substituted so two responses can be compared as bytes. An extra key on
  // the filtered path — hidden, filtered, reason — would survive and fail the equality.
  const names = { id: 'ID', workId: 'WID', authorId: 'UID', author: 'NAME', body: 'BODY', at: 'AT' };
  const out = {};
  for (const k of Object.keys(comment).sort()) out[k] = names[k] ?? comment[k];
  return JSON.stringify({ comment: out });
}

describe('a filtered comment is the limit rung applied automatically', () => {
  before(async () => {
    PORT = await freePort();
    DB = join(mkdtempSync(join(tmpdir(), 'hidden-words-')), 'hidden-words.db');
    child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DB_PATH: DB, INVITE_CODE: 'hidden-words-test',
             OAUTH_STATE_SECRET: 'hidden-words-secret', METRICS_TOKEN: TOKEN },
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

  test('a comment containing a listed term is stored, is hidden_at, and is absent from another viewer', async () => {
    const w = await anaWork();
    const posted = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: `you are a ${SLUR}` },
    });
    assert.equal(posted.status, 200, 'the commenter must not learn they were filtered');
    assert.equal(posted.json.comment.body, `you are a ${SLUR}`);
    assert.equal(posted.json.comment.hiddenAt, undefined);
    assert.equal(posted.json.comment.filtered, undefined);

    const [row] = rows('SELECT body, hidden_at, hidden_reason FROM comment WHERE id = ?',
      posted.json.comment.id);
    assert.equal(row.body, `you are a ${SLUR}`, 'hide, never delete — ADR-0006');
    assert.ok(row.hidden_at, 'the hit is stored so a human can release a false positive');
    assert.equal(row.hidden_reason, 'filter');

    const theirs = await api(`/api/works/${w.id}/comments`, { as: 'ana' });
    assert.equal(theirs.json.comments.filter((c) => c.id === posted.json.comment.id).length, 0,
      'another viewer must not see it');

    const mine = await api(`/api/works/${w.id}/comments`, { as: 'ben' });
    assert.equal(mine.json.comments.filter((c) => c.id === posted.json.comment.id).length, 1,
      'the commenter still sees their own — do not "fix" this into equal visibility');
    const own = mine.json.comments.find((c) => c.id === posted.json.comment.id);
    assert.equal(own.body, `you are a ${SLUR}`);
    assert.equal(own.hidden, true);
    assert.equal(own.appealed, false);
    assert.equal(theirs.json.comments[0]?.hidden, undefined,
      'another viewer must never receive the hidden key, even on comments they can see');

    const [receipt] = rows(
      "SELECT type, user_id, payload FROM receipt WHERE type = 'moderation.limited' AND payload LIKE ?",
      `%${posted.json.comment.id}%`);
    assert.ok(receipt, 'a filter hit with no receipt is an enforcement action that left no record');
    assert.equal(receipt.user_id, 'usr_ben');
    const payload = JSON.parse(receipt.payload);
    assert.equal(payload.source, 'filter');
    assert.equal(payload.subject, posted.json.comment.id);
    assert.equal(payload.body, undefined);
    assert.ok(!JSON.stringify(payload).includes(SLUR),
      'receipts hash identifiers, not the words the filter matched');
  });

  test('the count matches the list each viewer sees', async () => {
    const w = await anaWork();
    assert.equal((await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'a clean remark' },
    })).status, 200);
    assert.equal((await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: `a ${SLUR} remark` },
    })).status, 200);

    const anaList = await api(`/api/works/${w.id}/comments`, { as: 'ana' });
    const benList = await api(`/api/works/${w.id}/comments`, { as: 'ben' });
    const anaWorkView = await api(`/api/works/${w.id}`, { as: 'ana' });
    const benWorkView = await api(`/api/works/${w.id}`, { as: 'ben' });

    assert.equal(anaList.json.comments.length, 1);
    assert.equal(benList.json.comments.length, 2);
    assert.equal(anaWorkView.json.work.comments, anaList.json.comments.length,
      'a count that includes what the list hides betrays the filter');
    assert.equal(benWorkView.json.work.comments, benList.json.comments.length);
    assert.equal(anaList.json.total, 1);
    assert.equal(benList.json.total, 2);
  });

  test('the Scunthorpe problem: an innocent word containing a listed term as a substring is NOT hidden', async () => {
    const w = await anaWork();
    const posted = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'I live in Scunthorpe' },
    });
    assert.equal(posted.status, 200);
    const [row] = rows('SELECT hidden_at FROM comment WHERE id = ?', posted.json.comment.id);
    assert.equal(row.hidden_at, null);

    const theirs = await api(`/api/works/${w.id}/comments`, { as: 'ana' });
    assert.equal(theirs.json.comments.filter((c) => c.id === posted.json.comment.id).length, 1,
      'Scunthorpe must remain visible — substring match is how this feature makes a product look stupid');
  });

  test('leetspeak folding catches an obvious evasion', async () => {
    const w = await anaWork();
    const posted = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: LEET },
    });
    assert.equal(posted.status, 200);
    const [row] = rows('SELECT hidden_at, hidden_reason FROM comment WHERE id = ?',
      posted.json.comment.id);
    assert.ok(row.hidden_at);
    assert.equal(row.hidden_reason, 'filter');

    const theirs = await api(`/api/works/${w.id}/comments`, { as: 'ana' });
    assert.equal(theirs.json.comments.filter((c) => c.id === posted.json.comment.id).length, 0);
  });

  test('a clean comment is untouched', async () => {
    const w = await anaWork();
    const posted = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'genuinely good work' },
    });
    assert.equal(posted.status, 200);
    const [row] = rows('SELECT hidden_at, hidden_reason FROM comment WHERE id = ?',
      posted.json.comment.id);
    assert.equal(row.hidden_at, null);
    assert.equal(row.hidden_reason, null);

    const theirs = await api(`/api/works/${w.id}/comments`, { as: 'ana' });
    assert.equal(theirs.json.comments.length, 1);
    assert.equal(theirs.json.comments[0].body, 'genuinely good work');
  });

  test('with filter_comments off, nothing is hidden', async () => {
    const w = await anaWork();
    const off = await api('/api/account/filter-comments', {
      method: 'POST', as: 'ana', body: { filterComments: false },
    });
    assert.equal(off.status, 200);
    assert.equal(off.json.user.filterComments, false);

    const posted = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: `you are a ${SLUR}` },
    });
    assert.equal(posted.status, 200);
    const [row] = rows('SELECT hidden_at FROM comment WHERE id = ?', posted.json.comment.id);
    assert.equal(row.hidden_at, null, 'the work owner opted out — comments they receive are not filtered');

    const theirs = await api(`/api/works/${w.id}/comments`, { as: 'ana' });
    assert.equal(theirs.json.comments.filter((c) => c.id === posted.json.comment.id).length, 1);

    const on = await api('/api/account/filter-comments', {
      method: 'POST', as: 'ana', body: { filterComments: true },
    });
    assert.equal(on.json.user.filterComments, true);
  });

  test('the API response is byte-identical whether or not the comment was filtered', async () => {
    const w = await anaWork();
    const clean = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'plain words' },
    });
    const filtered = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: `a ${SLUR}` },
    });
    assert.equal(clean.status, 200);
    assert.equal(filtered.status, 200);
    assert.equal(wire(filtered.json.comment), wire(clean.json.comment),
      'an extra field on the filtered path is how the commenter learns they were filtered');

    const mine = await api(`/api/works/${w.id}/comments`, { as: 'ben' });
    const seenClean = mine.json.comments.find((c) => c.id === clean.json.comment.id);
    const seenFiltered = mine.json.comments.find((c) => c.id === filtered.json.comment.id);
    assert.equal(seenFiltered.hidden, true,
      'GET may tell the author, so they have something to contest — POST still must not');
    assert.equal(seenFiltered.appealed, false);
    assert.equal(seenClean.hidden, undefined,
      'a clean comment must not grow a hidden key; that is how the author would learn the shape');
  });

  test('the operator queue lists the hit, and releasing writes a receipt', async () => {
    const w = await anaWork();
    const posted = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: `a ${SLUR}` },
    });
    const id = posted.json.comment.id;

    const closed = await api('/api/moderation/queue', { as: 'ana' });
    assert.equal(closed.status, 401, 'an ordinary session is not an operator');

    const queue = await api('/api/moderation/queue', { as: 'operator' });
    assert.equal(queue.status, 200);
    const hit = queue.json.hidden.find((c) => c.id === id);
    assert.ok(hit, 'a false positive that never reaches a human cannot be released');
    assert.equal(hit.body, `a ${SLUR}`);
    assert.equal(hit.reason, 'filter');

    const released = await api('/api/moderation/release', {
      method: 'POST', as: 'operator',
      body: { comment: id, reason: 'false positive — used in a citation' },
    });
    assert.equal(released.status, 200, released.text);
    assert.equal(released.json.action, 'release');
    assert.ok(released.json.receipt);

    const [row] = rows('SELECT hidden_at, hidden_reason FROM comment WHERE id = ?', id);
    assert.equal(row.hidden_at, null);
    assert.equal(row.hidden_reason, null);

    const theirs = await api(`/api/works/${w.id}/comments`, { as: 'ana' });
    assert.equal(theirs.json.comments.filter((c) => c.id === id).length, 1,
      'releasing is clearing the hide, not inventing a new comment');

    const [receipt] = rows(
      "SELECT type, user_id, payload FROM receipt WHERE type = 'moderation.restored'");
    assert.ok(receipt, 'a moderation act with no receipt is not a moderation act');
    assert.equal(receipt.user_id, 'usr_ben');
    assert.equal(JSON.parse(receipt.payload).subject, id);

    const again = await api('/api/moderation/release', {
      method: 'POST', as: 'operator',
      body: { comment: id, reason: 'already out' },
    });
    assert.equal(again.status, 409);
  });

  test('filter_comments defaults on, and absent is not off', async () => {
    const me = await api('/api/me', { as: 'ben' });
    assert.equal(me.json.user.filterComments, true);
    const [row] = rows("SELECT filter_comments FROM user WHERE id = 'usr_ben'");
    assert.equal(row.filter_comments, 1);
  });
});
