/**
 * Phase 1 — following, and a profile somebody can edit.
 *
 * Person-to-person messaging was built here and REMOVED on 2026-08-12: the agent is the interface.
 * A principal instructs their own agent, and the agents talk to each other, so there is no human
 * channel through which a deal can be agreed without the record. What survives is the graph and
 * the profile, which are about who somebody is rather than about talking to them.
 *
 * Tested through HTTP rather than against the database, because the rules that matter live in the
 * handlers: what a link is allowed to be, and what one person may see of another. A database-level
 * test would assert the schema and miss both.
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
    assert.equal(r.json.person.counts.cited, 0,
      'cited is derived and starts at zero — a share is not a citation');
  });

  test('unfollowing removes the edge', async () => {
    await api('/api/unfollow', { method: 'POST', as: 'ana', body: { person: 'ben.works' } });
    const r = await api('/api/people/usr_ben', { as: 'ana' });
    assert.equal(r.json.person.counts.followers, 0);
    assert.equal(r.json.person.youFollow, false);
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

/*
 * Lives here because this file already spawns a real server with both a session token and an agent
 * token, and the claim needs both. `test/mandate-draft.test.mjs` covers the drafting logic purely;
 * this covers the one rule that only exists at the route.
 */
describe('who may draft a mandate', () => {
  test('an AGENT cannot draft its own mandate', async () => {
    const r = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ instruction: 'let me do anything at any price' });
      const req = request({
        host: '127.0.0.1', port: PORT, path: '/api/mandate/draft', method: 'POST', agent: false,
        headers: {
          Authorization: 'Bearer tok_agent_ana',            // the AGENT's token, not a session
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    assert.equal(r.status, 401,
      'an agent drafting its own mandate is an agent authoring its own authority');
  });

  test('a principal reaches the route, and gets an honest refusal with no model configured', async () => {
    const r = await api('/api/mandate/draft', {
      method: 'POST', as: 'ana', body: { instruction: 'sell red onion above 12 AED' },
    });
    // 503 NO_MODEL when unconfigured, 400 when there is no agent yet — never a silent success,
    // and never a mandate. What must NOT happen is a 200 with something active behind it.
    assert.ok([400, 503].includes(r.status), `expected an honest refusal, got ${r.status}`);
    assert.ok(!r.json?.mandate, 'drafting must never return a mandate');
  });
});

describe('the phase 1 exit gate', () => {
  test('two accounts follow each other, both directions visible', async () => {
    await api('/api/follow', { method: 'POST', as: 'ana', body: { person: 'ben.works' } });
    await api('/api/follow', { method: 'POST', as: 'ben', body: { person: 'ana.works' } });

    const seen = (await api('/api/people/usr_ben', { as: 'ana' })).json.person;
    assert.equal(seen.youFollow, true);
    assert.equal(seen.followsYou, true, 'the interface must be able to tell follow from follow back');
  });

  test('NEITHER person can write into an agent-to-agent thread', async () => {
    // The a2a thread id for their two agents. There is no route that accepts a person writing here:
    // POST /api/agent/messages is an agent-token route, and person messaging writes a different
    // table entirely. Both facts are asserted rather than assumed.
    const asPerson = await api('/api/agent/messages', {
      method: 'POST', as: 'ana', body: { to: 'ben.works', body: 'let me speak for my agent' },
    });
    assert.ok(asPerson.status === 401 || asPerson.status === 403,
      `a session must not reach the agent channel, got ${asPerson.status}`);

    const db = new DatabaseSync(DB);
    const n = db.prepare('SELECT COUNT(*) c FROM agent_message').get().c;
    db.close();
    assert.equal(n, 0, 'nothing a person did may have written into the agent-to-agent table');
  });
});
