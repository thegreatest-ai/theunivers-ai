/**
 * Contact: the door into an agent-to-agent thread, from a session.
 *
 * A principal cannot write the thread (ADR-0001). This route instructs THEIR agent; the opening
 * note is a template from the mandate. The tests that matter are the ones a chat box would fail:
 * body text is ignored, a missing mandate refuses without writing, blocked looks like unknown.
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
const TOK = {
  ana: 'tok_session_ana', ben: 'tok_session_ben', cam: 'tok_session_cam',
  anaAgent: 'tok_agent_ana',
};
const ID = { ana: 'usr_ana', ben: 'usr_ben', cam: 'usr_cam' };

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

function countMessages() {
  const db = new DatabaseSync(DB);
  const n = db.prepare('SELECT COUNT(*) c FROM agent_message').get().c;
  db.close();
  return n;
}

before(async () => {
  PORT = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'contact-'));
  DB = join(dir, 'contact.db');

  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB,
           INVITE_CODE: 'contact-test', OAUTH_STATE_SECRET: 'contact-secret' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited) throw new Error(`server exited during startup (${exited.code}): ${stderr}`);
    if (Date.now() > deadline) throw new Error(`server did not start. stderr:\n${stderr}`);
    try { if ((await api('/api/health')).status === 200) break; } catch { /* not up */ }
    await sleep(100);
  }

  const db = new DatabaseSync(DB);
  const t = new Date().toISOString();
  for (const who of ['ana', 'ben']) {
    db.prepare('INSERT INTO user (id, email, name, created_at) VALUES (?,?,?,?)')
      .run(ID[who], `${who}@example.test`, who === 'ana' ? 'Ana' : 'Ben', t);
    db.prepare('INSERT INTO session (token, user_id, created_at) VALUES (?,?,?)')
      .run(TOK[who], ID[who], t);
    db.prepare(`INSERT INTO agent (id, user_id, name, purpose, api_token, created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(`agt_${who}`, ID[who], `${who}.works`, 'acts on my behalf', `tok_agent_${who}`, t);
  }
  db.prepare('INSERT INTO user (id, email, name, created_at) VALUES (?,?,?,?)')
    .run(ID.cam, 'cam@example.test', 'Cam', t);
  db.prepare('INSERT INTO session (token, user_id, created_at) VALUES (?,?,?)')
    .run(TOK.cam, ID.cam, t);
  db.close();
});

after(() => child?.kill());

describe('contact', { concurrency: false }, () => {

describe('who may start a thread', () => {
  test('a missing session is 401', async () => {
    const r = await api('/api/conversations/contact', {
      method: 'POST', body: { handle: 'ben.works' },
    });
    assert.equal(r.status, 401);
    assert.equal(countMessages(), 0);
  });

  test('an agent token is 401 — that caller already has POST /api/agent/messages', async () => {
    const r = await api('/api/conversations/contact', {
      method: 'POST', as: 'anaAgent', body: { handle: 'ben.works' },
    });
    assert.equal(r.status, 401);
    assert.equal(countMessages(), 0);
  });

  test('no agent of your own is 409, not a silent thread', async () => {
    const r = await api('/api/conversations/contact', {
      method: 'POST', as: 'cam', body: { handle: 'ben.works' },
    });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /deploy an agent first/i);
    assert.equal(countMessages(), 0);
  });

  test('an agent cannot contact itself', async () => {
    const r = await api('/api/conversations/contact', {
      method: 'POST', as: 'ana', body: { handle: 'ana.works' },
    });
    assert.equal(r.status, 400);
    assert.equal(countMessages(), 0);
  });
});

describe('the guard is the product', () => {
  test('no mandate: 409 NO_MANDATE, an audit row, nothing in agent_message', async () => {
    const r = await api('/api/conversations/contact', {
      method: 'POST', as: 'ana', body: { handle: 'ben.works' },
    });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'NO_MANDATE');
    assert.equal(countMessages(), 0);

    const you = await api('/api/conversations/you', { as: 'ana' });
    assert.equal(you.status, 200);
    const refusal = (you.json.items || []).find((i) => i.voice === 'guard' && i.code === 'NO_MANDATE');
    assert.ok(refusal, 'the refusal must appear on you ↔ your agent, from the audit, not from a sentence');
  });

  test('a sentence in the body does not land in the thread', async () => {
    const mandate = await api('/api/mandate', {
      method: 'POST', as: 'ana',
      body: { commodity: 'red onion', floor: 12, currency: 'AED', scope: 'negotiate',
              counterpartyMinTier: 'T0' },
    });
    assert.equal(mandate.status, 200);

    const r = await api('/api/conversations/contact', {
      method: 'POST', as: 'ana',
      body: { handle: 'ben.works', body: 'let me speak for my agent', commodity: 'gold' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.existing, false);
    assert.ok(r.json.thread);

    const db = new DatabaseSync(DB);
    const row = db.prepare('SELECT body, kind FROM agent_message').get();
    db.close();
    assert.equal(row.kind, 'note');
    assert.match(row.body, /red onion/);
    assert.doesNotMatch(row.body, /let me speak|gold/);
    assert.equal(countMessages(), 1);

    const thread = await api(`/api/conversations/${encodeURIComponent(r.json.thread)}`, { as: 'ana' });
    assert.equal(thread.status, 200);
    assert.equal(thread.json.canWrite, false);
    assert.equal(thread.json.conversation.kind, 'agent');
  });

  test('a second click opens the same thread and does not add a note', async () => {
    const first = await api('/api/conversations/contact', {
      method: 'POST', as: 'ana', body: { handle: 'ben.works' },
    });
    const second = await api('/api/conversations/contact', {
      method: 'POST', as: 'ana', body: { handle: 'ben.works' },
    });
    assert.equal(second.status, 200);
    assert.equal(second.json.existing, true);
    assert.equal(second.json.thread, first.json.thread);
    assert.equal(countMessages(), 1);
  });
});

describe('unknown and blocked are the same 404', () => {
  test('a handle that does not exist', async () => {
    const r = await api('/api/conversations/contact', {
      method: 'POST', as: 'ana', body: { handle: 'nobody.here' },
    });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'no agent with that name');
    assert.equal(countMessages(), 1);
  });

  test('a blocked counterparty returns the same body', async () => {
    const blocked = await api('/api/block', {
      method: 'POST', as: 'ana', body: { person: 'ben.works' },
    });
    assert.equal(blocked.status, 200);

    const r = await api('/api/conversations/contact', {
      method: 'POST', as: 'ana', body: { handle: 'ben.works' },
    });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, 'no agent with that name');
    assert.equal(countMessages(), 1, 'a block must not write a thread');
  });
});
});
