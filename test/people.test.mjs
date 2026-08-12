/**
 * Phase 1 — the parts of a social product that are about PEOPLE: following, person-to-person
 * messaging, and a profile somebody can edit.
 *
 * Tested through HTTP rather than against the database, because the rules that matter here live in
 * the handlers: who may decide a request, how many messages a stranger gets, and what a link is
 * allowed to be. A database-level test would assert the schema and miss all three.
 *
 * The exit gate for this phase is at the bottom: two accounts can hold a conversation, follow each
 * other, and NEITHER can write into an agent-to-agent thread.
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
const TOK = { ana: 'tok_session_ana', ben: 'tok_session_ben' };
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
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

before(async () => {
  PORT = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'people-'));
  DB = join(dir, 'people.db');

  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB,
           INVITE_CODE: 'people-test', OAUTH_STATE_SECRET: 'people-secret' },
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

  // Two people with live sessions, written straight in — registration is exercised elsewhere and
  // is not what these tests are about.
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
  db.close();
});

after(() => child?.kill());

describe('following', () => {
  test('a person can follow another, and the counts are derived from the rows', async () => {
    const r = await api('/api/follow', { method: 'POST', as: 'ana', body: { person: 'ben.works' } });
    assert.equal(r.status, 200);
    assert.equal(r.json.following, true);
    assert.equal(r.json.person.counts.followers, 1);
    assert.equal(r.json.person.youFollow, true);
    assert.equal(r.json.person.followsYou, false, 'Ben has not followed back');
  });

  test('following twice is the same as following once', async () => {
    await api('/api/follow', { method: 'POST', as: 'ana', body: { person: 'ben.works' } });
    const r = await api('/api/people/usr_ben', { as: 'ana' });
    assert.equal(r.json.person.counts.followers, 1, 'a duplicate follow must not double the count');
  });

  test('a person cannot follow themselves', async () => {
    const r = await api('/api/follow', { method: 'POST', as: 'ana', body: { person: 'ana.works' } });
    assert.equal(r.status, 400);
  });

  test('a handle resolves to its person, because a handle is what people actually use', async () => {
    const r = await api('/api/people/ben.works', { as: 'ana' });
    assert.equal(r.status, 200);
    assert.equal(r.json.person.id, ID.ben);
  });

  test('the follower list reads both directions from one shape', async () => {
    const followers = await api('/api/people/usr_ben/follows?direction=followers', { as: 'ben' });
    assert.deepEqual(followers.json.people.map((p) => p.id), [ID.ana]);
    const following = await api('/api/people/usr_ben/follows?direction=following', { as: 'ben' });
    assert.deepEqual(following.json.people, []);
  });

  test('a profile does not leak the other person\'s email or sign-in method', async () => {
    const r = await api('/api/people/usr_ben', { as: 'ana' });
    assert.equal(r.json.person.email, undefined, 'email is nobody else\'s business');
    assert.equal(r.json.person.hasPassword, undefined);
    assert.equal(r.json.person.signInMethod, undefined);
  });

  test('unfollowing removes the edge', async () => {
    await api('/api/unfollow', { method: 'POST', as: 'ana', body: { person: 'ben.works' } });
    const r = await api('/api/people/usr_ben', { as: 'ana' });
    assert.equal(r.json.person.counts.followers, 0);
    assert.equal(r.json.person.youFollow, false);
    // put it back for the messaging tests below
  });
});

describe('messaging a person who does not follow you', () => {
  test('the first message opens a REQUEST, not an open channel', async () => {
    const r = await api('/api/people/messages', {
      method: 'POST', as: 'ana', body: { person: 'ben.works', body: 'Hello — I liked your work.' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.thread.state, 'pending');
  });

  test('a stranger gets exactly ONE message until it is accepted', async () => {
    const second = await api('/api/people/messages', {
      method: 'POST', as: 'ana', body: { person: 'ben.works', body: 'And another thing' },
    });
    assert.equal(second.status, 429, 'this is what stops a request being a channel for a hundred');
  });

  test('the recipient sees it as awaiting them; the sender does not', async () => {
    const bens = await api('/api/people/threads', { as: 'ben' });
    assert.equal(bens.json.requests, 1);
    assert.equal(bens.json.threads[0].awaitingYou, true);

    const anas = await api('/api/people/threads', { as: 'ana' });
    assert.equal(anas.json.requests, 0, 'your own outgoing request is not a request TO you');
    assert.equal(anas.json.threads[0].canWrite, false, 'and you cannot keep writing into it');
  });

  test('the sender cannot accept their own request', async () => {
    const id = (await api('/api/people/threads', { as: 'ana' })).json.threads[0].id;
    const r = await api('/api/people/threads/decide', {
      method: 'POST', as: 'ana', body: { thread: id, decision: 'accept' },
    });
    assert.equal(r.status, 403);
  });

  test('a stranger cannot read a thread they are not in', async () => {
    const id = (await api('/api/people/threads', { as: 'ana' })).json.threads[0].id;
    // A third party with a valid session but no membership.
    const db = new DatabaseSync(DB);
    const t = new Date().toISOString();
    db.prepare('INSERT INTO user (id,email,name,created_at) VALUES (?,?,?,?)')
      .run('usr_cee', 'cee@example.test', 'Cee', t);
    db.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)')
      .run('tok_session_cee', 'usr_cee', t);
    db.close();
    TOK.cee = 'tok_session_cee';

    const r = await api(`/api/people/threads/${id}`, { as: 'cee' });
    assert.equal(r.status, 404, 'membership is read from the row, never parsed out of the id');
  });

  test('accepting opens it, and then the conversation actually works', async () => {
    const id = (await api('/api/people/threads', { as: 'ben' })).json.threads[0].id;
    const decided = await api('/api/people/threads/decide', {
      method: 'POST', as: 'ben', body: { thread: id, decision: 'accept' },
    });
    assert.equal(decided.status, 200);
    assert.equal(decided.json.thread.state, 'accepted');

    assert.equal((await api('/api/people/messages', {
      method: 'POST', as: 'ana', body: { person: 'ben.works', body: 'Thank you.' },
    })).status, 200, 'the sender may write once accepted');

    assert.equal((await api('/api/people/messages', {
      method: 'POST', as: 'ben', body: { person: 'ana.works', body: 'Of course.' },
    })).status, 200, 'and so may the recipient');

    const thread = await api(`/api/people/threads/${id}`, { as: 'ana' });
    assert.equal(thread.json.messages.length, 3);
    assert.deepEqual(thread.json.messages.map((m) => m.mine), [true, true, false]);
  });

  test('replying to a request accepts it — you cannot answer and still be deciding', async () => {
    // A fresh pair, so this is independent of the accept/decline above.
    const db = new DatabaseSync(DB);
    const t = new Date().toISOString();
    db.prepare('INSERT INTO user (id,email,name,created_at) VALUES (?,?,?,?)')
      .run('usr_dee', 'dee@example.test', 'Dee', t);
    db.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)')
      .run('tok_session_dee', 'usr_dee', t);
    db.close();
    TOK.dee = 'tok_session_dee';

    const opened = await api('/api/people/messages', {
      method: 'POST', as: 'ana', body: { person: 'usr_dee', body: 'A cold approach.' },
    });
    assert.equal(opened.json.thread.state, 'pending');

    // Dee replies WITHOUT calling decide.
    const reply = await api('/api/people/messages', {
      method: 'POST', as: 'dee', body: { person: 'ana.works', body: 'Go on then.' },
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.json.thread.state, 'accepted', 'the reply itself is the acceptance');

    // And the original sender is no longer capped — the bug this test exists for was that they were.
    const second = await api('/api/people/messages', {
      method: 'POST', as: 'ana', body: { person: 'usr_dee', body: 'Here is the detail.' },
    });
    assert.equal(second.status, 200, 'a replied-to thread must not still cap the opener at one');

    const dees = await api('/api/people/threads', { as: 'dee' });
    assert.equal(dees.json.requests, 0, 'and it must not still show as an undecided request');
  });

  test('a second decision on a settled thread is refused', async () => {
    const id = (await api('/api/people/threads', { as: 'ben' })).json.threads[0].id;
    const r = await api('/api/people/threads/decide', {
      method: 'POST', as: 'ben', body: { thread: id, decision: 'decline' },
    });
    assert.equal(r.status, 409);
  });
});

describe('messaging a person who already follows you', () => {
  test('following is the opt-in: the thread opens accepted, with no request to answer', async () => {
    // Cee follows Ana, so Ana writing to Cee needs no ceremony.
    await api('/api/follow', { method: 'POST', as: 'cee', body: { person: 'ana.works' } });
    const r = await api('/api/people/messages', {
      method: 'POST', as: 'ana', body: { person: 'usr_cee', body: 'You followed me — hello.' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.thread.state, 'accepted');

    assert.equal((await api('/api/people/messages', {
      method: 'POST', as: 'ana', body: { person: 'usr_cee', body: 'Second message, allowed.' },
    })).status, 200, 'no one-message cap on an accepted thread');
  });
});

describe('the profile', () => {
  test('a bio and links can be set, and come back', async () => {
    const r = await api('/api/profile/edit', {
      method: 'POST', as: 'ana',
      body: { bio: 'I photograph buildings.', links: [{ label: 'Site', url: 'https://example.test' }] },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.person.bio, 'I photograph buildings.');
    assert.deepEqual(r.json.person.links, [{ label: 'Site', url: 'https://example.test' }]);
  });

  test('a javascript: URL is refused, not escaped somewhere later', async () => {
    const r = await api('/api/profile/edit', {
      method: 'POST', as: 'ana',
      body: { links: [{ label: 'x', url: 'javascript:alert(1)' }] },
    });
    assert.equal(r.status, 400);
  });

  test('a link with no label falls back to the address rather than rendering blank', async () => {
    const r = await api('/api/profile/edit', {
      method: 'POST', as: 'ana', body: { links: [{ url: 'https://example.test/portfolio' }] },
    });
    assert.equal(r.json.person.links[0].label, 'example.test/portfolio');
  });

  test('editing a profile cannot touch standing', async () => {
    const before = (await api('/api/people/usr_ana', { as: 'ben' })).json.person.trust;
    await api('/api/profile/edit', { method: 'POST', as: 'ana', body: { bio: 'T4 VERIFIED ELITE' } });
    const after = (await api('/api/people/usr_ana', { as: 'ben' })).json.person.trust;

    // Tier and score, not the whole object: `recency` is a continuous decay, so two reads a
    // millisecond apart differ in the tenth decimal place and a deepEqual here is flaky by
    // construction. Tier and score are what standing IS; the components are how it was reached.
    assert.equal(after.tier, before.tier, 'a bio is a claim, not evidence');
    assert.equal(after.score, before.score);
    assert.equal(after.tier, 'T0', 'and writing T4 in your bio does not make you T4');
  });
});

describe('the phase 1 exit gate', () => {
  test('two accounts hold a conversation, and follow each other', async () => {
    await api('/api/follow', { method: 'POST', as: 'ana', body: { person: 'ben.works' } });
    await api('/api/follow', { method: 'POST', as: 'ben', body: { person: 'ana.works' } });

    const ana = (await api('/api/people/usr_ben', { as: 'ana' })).json.person;
    assert.equal(ana.youFollow, true);
    assert.equal(ana.followsYou, true);

    const id = (await api('/api/people/threads', { as: 'ana' })).json.threads
      .find((t) => t.with.id === ID.ben).id;
    const thread = await api(`/api/people/threads/${id}`, { as: 'ana' });
    assert.ok(thread.json.messages.length >= 3, 'a real conversation, both directions');
    assert.ok(thread.json.messages.some((m) => m.mine) && thread.json.messages.some((m) => !m.mine));
  });

  test('NEITHER person can write into an agent-to-agent thread', async () => {
    // The a2a thread id for their two agents. There is no route that accepts a person writing here:
    // POST /api/agent/messages is an agent-token route, and person messaging writes a different
    // table entirely. Both facts are asserted rather than assumed.
    const a2a = `a2a_${['agt_ana', 'agt_ben'].sort().join('_')}`;

    const asPerson = await api('/api/agent/messages', {
      method: 'POST', as: 'ana', body: { to: 'ben.works', body: 'let me speak for my agent' },
    });
    assert.ok(asPerson.status === 401 || asPerson.status === 403,
      `a session must not reach the agent channel, got ${asPerson.status}`);

    const readBack = await api(`/api/people/threads/${a2a}`, { as: 'ana' });
    assert.equal(readBack.status, 404, 'an agent thread id is not a person thread');

    const db = new DatabaseSync(DB);
    const n = db.prepare('SELECT COUNT(*) c FROM agent_message').get().c;
    db.close();
    assert.equal(n, 0, 'nothing a person did may have written into the agent-to-agent table');
  });
});
