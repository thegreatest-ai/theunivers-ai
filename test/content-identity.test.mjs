/**
 * A work is what its author called it; a thread is two levels, not a tree.
 *
 * HTTP for the behaviour a person meets. Source-reading for display order and the
 * View replies (N) control, because those are layout. See docs/specs/CONTENT-IDENTITY.md.
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOK = { ana: 'tok_ci_ana', ben: 'tok_ci_ben' };
const AGENT = { ana: 'tok_agent_ci_ana', ben: 'tok_agent_ci_ben' };
const SLUR = 'nigger';

let PORT; let child; let DB;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function api(path, { method = 'GET', as, agent, body, raw, type, headers } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw ?? (body === undefined ? null : JSON.stringify(body));
    const auth = agent ? AGENT[agent] : (as ? TOK[as] : null);
    const req = request({
      host: '127.0.0.1', port: PORT, path, method, agent: false,
      headers: {
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(payload ? {
          'content-type': type || (raw ? 'application/octet-stream' : 'application/json'),
          'content-length': Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload),
        } : {}),
        ...headers,
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

before(async () => {
  PORT = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'content-identity-'));
  DB = join(dir, 'content-identity.db');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, MEDIA_PATH: join(dir, 'media'),
           INVITE_CODE: 'content-identity-test', OAUTH_STATE_SECRET: 'content-identity-secret' },
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
      .run(`agt_${who}`, `usr_${who}`, `${who}.ci`, 'acts', AGENT[who], t);
  }
  db.close();
});

after(() => child?.kill());

async function anaWork() {
  const r = await api('/api/works', {
    method: 'POST', as: 'ana', body: { kind: 'thread', title: '', body: 'a work worth talking about' },
  });
  assert.equal(r.status, 200, r.text);
  return r.json.work;
}

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('a document is named by its author, not its file', () => {
  test('name, description and filename all come back, in that order on the glass', async () => {
    const made = await api('/api/works', {
      method: 'POST', as: 'ana',
      body: { kind: 'doc', title: 'Farida Baharoon CV', body: 'The one to send.' },
    });
    assert.equal(made.status, 200, made.text);
    const id = made.json.work.id;
    const up = await api(`/api/works/${id}/media`, {
      method: 'POST', as: 'ana', raw: Buffer.from('%PDF-1.4 test'), type: 'application/pdf',
      headers: { 'x-filename': encodeURIComponent('Farida Baharoon CV.pdf') },
    });
    assert.equal(up.status, 200, up.text);

    const seen = await api(`/api/works/${id}`, { as: 'ben' });
    assert.equal(seen.json.work.title, 'Farida Baharoon CV');
    assert.equal(seen.json.work.body, 'The one to send.');
    assert.ok(seen.json.work.media[0].filename);

    const works = read('src/app/Works.jsx');
    const detail = read('src/app/WorkDetail.jsx');
    const worksDoc = works.slice(works.indexOf("w.kind === 'doc'"));
    const titleAt = worksDoc.indexOf('{w.title &&');
    const bodyAt = worksDoc.indexOf('{w.body &&');
    const fileAt = worksDoc.indexOf('filename');
    assert.ok(titleAt >= 0 && bodyAt > titleAt && fileAt > bodyAt,
      'the grid must paint name → description → filename');
    const detailDoc = detail.slice(detail.indexOf("work.kind === 'doc'"));
    assert.match(detailDoc, /work\.title/);
    assert.match(detailDoc, /work\.body/);
    assert.match(detailDoc, /m\.filename/);
    assert.doesNotMatch(detailDoc, /Untitled/);
    assert.doesNotMatch(worksDoc.slice(0, 800), /Untitled/);
  });
});

describe('replies are two levels, collapsed, and Hidden Words still holds', () => {
  test('a reply to a reply is stored against the top-level parent, never a third level', async () => {
    const w = await anaWork();
    const top = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'first point' },
    });
    assert.equal(top.status, 200, top.text);
    const mid = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ana', body: { body: 'answering ben', parent: top.json.comment.id },
    });
    assert.equal(mid.status, 200, mid.text);
    assert.equal(mid.json.comment.parentId, top.json.comment.id);

    const deep = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'back at you', parent: mid.json.comment.id },
    });
    assert.equal(deep.status, 200, deep.text);
    assert.equal(deep.json.comment.parentId, top.json.comment.id,
      'flattening is the whole constraint');
    assert.match(deep.json.comment.body, /^@ana /,
      'a flattened reply carries an @mention of who was addressed');

    const [row] = rows('SELECT parent_id FROM comment WHERE id = ?', deep.json.comment.id);
    assert.equal(row.parent_id, top.json.comment.id);
    const third = rows('SELECT id FROM comment WHERE parent_id = ?', mid.json.comment.id);
    assert.equal(third.length, 0, 'nothing may hang off a reply');
  });

  test('View replies (N) counts what that viewer can see', async () => {
    const w = await anaWork();
    const top = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'openers' },
    });
    assert.equal((await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ana', body: { body: 'clean reply', parent: top.json.comment.id },
    })).status, 200);
    const hidden = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: `you are a ${SLUR}`, parent: top.json.comment.id },
    });
    assert.equal(hidden.status, 200, hidden.text);

    const anaTop = await api(`/api/works/${w.id}/comments`, { as: 'ana' });
    const benTop = await api(`/api/works/${w.id}/comments`, { as: 'ben' });
    const anaThread = anaTop.json.comments.find((c) => c.id === top.json.comment.id);
    const benThread = benTop.json.comments.find((c) => c.id === top.json.comment.id);
    assert.equal(anaThread.replies, 1, 'the hidden reply is absent from another viewer\'s count');
    assert.equal(benThread.replies, 2, 'the author still sees their own hidden reply');

    const anaReplies = await api(
      `/api/works/${w.id}/comments?parent=${encodeURIComponent(top.json.comment.id)}`, { as: 'ana' });
    const benReplies = await api(
      `/api/works/${w.id}/comments?parent=${encodeURIComponent(top.json.comment.id)}`, { as: 'ben' });
    assert.equal(anaReplies.json.comments.length, 1);
    assert.equal(benReplies.json.comments.length, 2);
    assert.equal(anaReplies.json.comments.some((c) => c.id === hidden.json.comment.id), false);
    assert.equal(benReplies.json.comments.some((c) => c.id === hidden.json.comment.id), true);

    const glass = read('src/app/WorkDetail.jsx');
    assert.match(glass, /View replies \(\$\{c\.replies\}\)/);
    assert.match(glass, /c\.replies > 0/, 'zero replies is absent, not a trophy of 0');
  });

  test('deleting a parent with replies raises rather than orphaning them', async () => {
    const w = await anaWork();
    const top = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'stay' },
    });
    assert.equal((await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ana', body: { body: 'a reply', parent: top.json.comment.id },
    })).status, 200);

    const del = await api('/api/comments/delete', {
      method: 'POST', as: 'ben', body: { id: top.json.comment.id },
    });
    assert.equal(del.status, 409, del.text);
    assert.ok(rows('SELECT id FROM comment WHERE id = ?', top.json.comment.id)[0],
      'the parent must survive');
    assert.equal(rows('SELECT id FROM comment WHERE parent_id = ?', top.json.comment.id).length, 1,
      'the reply must still be there');

    const db = new DatabaseSync(DB);
    db.exec('PRAGMA foreign_keys = ON');
    let raised = false;
    try {
      db.prepare('DELETE FROM comment WHERE id = ?').run(top.json.comment.id);
    } catch (e) {
      raised = true;
      assert.match(String(e.message), /FOREIGN KEY|constraint/i);
    } finally {
      db.close();
    }
    assert.ok(raised, 'RESTRICT must refuse a raw DELETE, not just the HTTP path');

    const fks = new DatabaseSync(DB);
    try {
      const parentFk = fks.prepare('PRAGMA foreign_key_list(comment)').all()
        .find((f) => f.from === 'parent_id');
      assert.ok(parentFk, 'parent_id must be a foreign key');
      assert.equal(parentFk.on_delete, 'RESTRICT');
    } finally { fks.close(); }
  });

  test('an agent token is refused a reply', async () => {
    const w = await anaWork();
    const top = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'a point' },
    });
    const r = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', agent: 'ben',
      body: { body: 'an agent has no mouth for this', parent: top.json.comment.id },
    });
    assert.equal(r.status, 401);
  });
});

describe('the fenced decisions hold', () => {
  test('the picker names the 40MB video cap and does not raise it', () => {
    const create = read('src/app/CreatePost.jsx');
    const works = read('src/app/Works.jsx');
    const storage = read('server/storage.mjs');
    assert.match(create, /Up to 40MB/);
    assert.match(works, /Up to 40MB/);
    assert.match(storage, /'video\/mp4': \{ max: 40_000_000/);
    assert.doesNotMatch(storage, /'video\/mp4': \{ max: (?:[5-9]\d|[1-9]\d{2,})_000_000/);
  });

  test('shared/ranking.mjs has no like as an input', () => {
    const src = read('shared/ranking.mjs');
    const code = src.slice(src.indexOf('const CITATION_WEIGHT'));
    assert.doesNotMatch(code, /\blikes?\b/i);
  });

  test('the profile grid is still 3:4 and uniform', () => {
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-shot\{[^}]*aspect-ratio:3\/4/s);
    const works = read('src/app/Works.jsx');
    assert.doesNotMatch(works, /cellAspect/);
    assert.doesNotMatch(works, /feedAspect/);
  });
});
