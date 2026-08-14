/**
 * Work detail: comments, edit, and the withdraw-if-commented rule.
 *
 * The who-may tests prove the routes demand the right credential. This file proves the behaviour
 * a person actually meets: an agent cannot comment, a stranger cannot edit, a work under review
 * cannot be mutated, a commented work is withdrawn rather than deleted, and an uncommented one
 * still really disappears — bytes included.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOK = { ana: 'tok_w_ana', ben: 'tok_w_ben' };
const AGENT = { ana: 'tok_agent_w_ana', ben: 'tok_agent_w_ben' };

let PORT; let child; let DB; let MEDIA;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function api(path, { method = 'GET', as, agent, body, raw, type } = {}) {
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
  const dir = mkdtempSync(join(tmpdir(), 'work-actions-'));
  DB = join(dir, 'work-actions.db');
  MEDIA = join(dir, 'media');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, MEDIA_PATH: MEDIA,
           INVITE_CODE: 'work-actions-test', OAUTH_STATE_SECRET: 'work-actions-secret' },
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
      .run(`agt_${who}`, `usr_${who}`, `${who}.work`, 'acts', AGENT[who], t);
  }
  db.close();
});

after(() => child?.kill());

async function anaWork(kind = 'thread', extra = {}) {
  const r = await api('/api/works', {
    method: 'POST', as: 'ana',
    body: { kind, title: extra.title ?? 'a work', body: extra.body ?? 'the body' },
  });
  assert.equal(r.status, 200, r.text);
  return r.json.work;
}

describe('who may comment and who may edit', () => {
  test('an agent token is refused a comment', async () => {
    const w = await anaWork();
    const r = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', agent: 'ben', body: { body: 'an agent has no mouth for this' },
    });
    assert.equal(r.status, 401, 'a comment is a human utterance, same credential as share');
  });

  test('a person can comment, and a stranger cannot edit', async () => {
    const w = await anaWork();
    const comment = await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'useful, I filed this' },
    });
    assert.equal(comment.status, 200, comment.text);
    assert.equal(comment.json.comment.body, 'useful, I filed this');

    const edit = await api('/api/works/update', {
      method: 'POST', as: 'ben', body: { id: w.id, title: 'hijacked', body: 'not yours' },
    });
    assert.equal(edit.status, 404, 'a stranger must not be able to edit; 404 does not confirm the row');
    const [row] = rows('SELECT title, body FROM work WHERE id = ?', w.id);
    assert.equal(row.title, 'a work');
    assert.equal(row.body, 'the body');
  });

  test('the author can edit title and body, and the stamp is visible', async () => {
    const w = await anaWork();
    const r = await api('/api/works/update', {
      method: 'POST', as: 'ana', body: { id: w.id, title: 'revised', body: 'still the body' },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.work.title, 'revised');
    assert.equal(r.json.work.edited, true);
    assert.ok(r.json.work.editedAt);
    const [row] = rows('SELECT title, kind, edited_at FROM work WHERE id = ?', w.id);
    assert.equal(row.kind, 'thread', 'edit must never touch the kind');
    assert.ok(row.edited_at);
  });
});

describe('a work under review cannot be mutated', () => {
  test('a limited work refuses both edit and delete with 409', async () => {
    const w = await anaWork();
    const db = new DatabaseSync(DB);
    db.prepare('UPDATE work SET limited_at = ? WHERE id = ?').run(new Date().toISOString(), w.id);
    db.close();

    const edit = await api('/api/works/update', {
      method: 'POST', as: 'ana', body: { id: w.id, title: 'escape', body: 'changed under review' },
    });
    assert.equal(edit.status, 409);

    const del = await api('/api/works/delete', { method: 'POST', as: 'ana', body: { id: w.id } });
    assert.equal(del.status, 409);
    assert.ok(rows('SELECT id FROM work WHERE id = ?', w.id)[0], 'the work must survive the attempt');
  });
});

describe('a commented work is withdrawn, an uncommented one is deleted', () => {
  test('deleting a commented work withdraws it and the comment still resolves', async () => {
    const w = await anaWork();
    assert.equal((await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'leaving a record' },
    })).status, 200);

    const del = await api('/api/works/delete', { method: 'POST', as: 'ana', body: { id: w.id } });
    assert.equal(del.status, 200, del.text);
    assert.equal(del.json.withdrawn, true);

    const [row] = rows('SELECT title, body, withdrawn_at FROM work WHERE id = ?', w.id);
    assert.ok(row, 'the row survives so the comment has somewhere to resolve');
    assert.ok(row.withdrawn_at);
    assert.equal(row.title, '');
    assert.equal(row.body, '');

    const tomb = await api(`/api/works/${w.id}`, { as: 'ben' });
    assert.equal(tomb.status, 200, 'a tombstone, never a 404');
    assert.equal(tomb.json.work.withdrawn, true);

    const comments = await api(`/api/works/${w.id}/comments`, { as: 'ben' });
    assert.equal(comments.status, 200);
    assert.equal(comments.json.comments.length, 1);
    assert.equal(comments.json.comments[0].body, 'leaving a record');

    const grid = await api('/api/works?user=usr_ana', { as: 'ben' });
    assert.equal(grid.json.works.filter((x) => x.id === w.id).length, 0,
      'a withdrawn work leaves the grid the way a withdrawn post leaves the feed');
  });

  test('deleting an uncommented work still hard-deletes and its bytes go', async () => {
    const made = await api('/api/works', {
      method: 'POST', as: 'ana', body: { kind: 'photo', title: 'to erase' },
    });
    assert.equal(made.status, 200, made.text);
    const id = made.json.work.id;

    const up = await api(`/api/works/${id}/media`, {
      method: 'POST', as: 'ana', raw: Buffer.alloc(4096, 7), type: 'image/jpeg',
    });
    assert.equal(up.status, 200, up.text);

    const [media] = rows('SELECT path FROM media WHERE work_id = ?', id);
    assert.ok(media?.path);
    const abs = join(MEDIA, media.path);
    assert.ok(existsSync(abs), 'the bytes must have landed so the deletion can be shown to remove them');

    const del = await api('/api/works/delete', { method: 'POST', as: 'ana', body: { id } });
    assert.equal(del.status, 200, del.text);
    assert.equal(del.json.withdrawn, undefined);
    assert.equal(rows('SELECT id FROM work WHERE id = ?', id).length, 0);
    assert.equal(rows('SELECT id FROM media WHERE work_id = ?', id).length, 0);
    assert.equal(existsSync(abs), false, 'a deletion that leaves the file behind is not a deletion');
  });
});

describe('counts are the numbers the database holds', () => {
  test('views, comments and citations on the work are derived, not stored', async () => {
    const w = await anaWork();
    assert.equal((await api(`/api/works/${w.id}/comments`, {
      method: 'POST', as: 'ben', body: { body: 'one' },
    })).status, 200);
    assert.equal((await api('/api/views', {
      method: 'POST', as: 'ben', body: { works: [w.id] },
    })).status, 200);
    // A second view by the same person must not inflate the number.
    await api('/api/views', { method: 'POST', as: 'ben', body: { works: [w.id] } });

    const t = new Date().toISOString();
    const db = new DatabaseSync(DB);
    db.prepare('INSERT INTO project (id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('prj_cnt', 'usr_ben', 'work', t, t);
    db.prepare('INSERT INTO note (id,project_id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run('nte_cnt', 'prj_cnt', 'usr_ben', 'a note', t, t);
    db.prepare(`INSERT INTO source (id,note_id,user_id,work_id,author_id,title,created_at)
                VALUES (?,?,?,?,?,?,?)`)
      .run('src_cnt', 'nte_cnt', 'usr_ben', w.id, 'usr_ana', 'a work', t);
    db.prepare(`INSERT INTO citation (id,note_id,source_id,user_id,work_id,author_id,used_for,created_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run('cit_cnt', 'nte_cnt', 'src_cnt', 'usr_ben', w.id, 'usr_ana', 'built on it', t);
    db.close();

    const seen = await api(`/api/works/${w.id}`, { as: 'ana' });
    assert.equal(seen.status, 200, seen.text);
    assert.equal(seen.json.work.comments, 1);
    assert.equal(seen.json.work.cited, 1);
    assert.equal(seen.json.work.views.people, 1);
    assert.equal(seen.json.work.views.agents, 0);

    const comments = rows('SELECT id FROM comment WHERE work_id = ?', w.id).length;
    const cited = rows(
      'SELECT COUNT(DISTINCT user_id) c FROM citation WHERE work_id = ? AND author_id IS NOT NULL',
      w.id)[0].c;
    const people = rows(
      "SELECT COUNT(*) c FROM work_view WHERE work_id = ? AND kind = 'person'", w.id)[0].c;
    assert.equal(seen.json.work.comments, comments);
    assert.equal(seen.json.work.cited, cited);
    assert.equal(seen.json.work.views.people, people);
  });
});

test('a null ratio does not become a zero-height box', () => {
  const src = readFileSync(join(ROOT, 'src/app/WorkDetail.jsx'), 'utf8');
  const css = readFileSync(join(ROOT, 'src/app/app.css'), 'utf8');
  assert.match(src, /typeof ratio === 'number' && ratio > 0/,
    'the client must not apply a ratio of 0, or of null-coerced-to-0');
  assert.match(css, /wk-detail-stage\{[^}]*min-height:240px/s,
    'when the ratio is absent the stage still occupies a real box');
  assert.doesNotMatch(src, /naturalWidth/,
    'dimensions come from the bytes, already computed; reading naturalWidth is the jump this exists to prevent');
});
