/**
 * The browser reporting what it could not do.
 *
 * This exists because on 2026-08-12 the marketing page was blank in production for ninety minutes
 * and nothing told us: the health check passed (the API was fine), the tests passed (they served no
 * CSP), and the deploy check passed (a blank page answers 200).
 *
 * It is the ONLY unauthenticated write path in the product, so most of what is tested here is the
 * door rather than the feature — the response must be identical whether a report was stored,
 * dropped or refused, or it becomes an oracle for whoever is probing it.
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
const TOKEN = 'operator-token-for-telemetry-test';
let PORT; let child; let DB;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function api(path, { method = 'GET', body, auth } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request({
      host: '127.0.0.1', port: PORT, path, method, agent: false,
      headers: {
        'user-agent': 'test-agent/1.0',
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
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

const rows = () => {
  const d = new DatabaseSync(DB);
  const r = d.prepare('SELECT * FROM client_error ORDER BY created_at').all();
  d.close();
  return r;
};

before(async () => {
  PORT = await freePort();
  DB = join(mkdtempSync(join(tmpdir(), 'telemetry-')), 't.db');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, INVITE_CODE: 'tel-test',
           OAUTH_STATE_SECRET: 'tel-secret', METRICS_TOKEN: TOKEN },
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
});

after(() => child?.kill());

describe('reporting', () => {
  test('a browser with no session can report — that is the whole point', async () => {
    const r = await api('/api/telemetry/error', {
      method: 'POST',
      body: { kind: 'error', message: 'Could not load hdri: Failed to fetch', source: 'at Scene', path: '/' },
    });
    assert.equal(r.status, 200);
    const stored = rows();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].kind, 'error');
    assert.match(stored[0].message, /Could not load hdri/);
  });

  test('THE BLANK REPORT — the signal that would have caught the real outage', async () => {
    await api('/api/telemetry/error', {
      method: 'POST',
      body: { kind: 'blank', message: 'root element still empty 8s after load', path: '/' },
    });
    assert.ok(rows().some((r) => r.kind === 'blank'), 'a page reporting itself blank is an outage');
  });

  test('the user agent is recorded from the header, never from the body', async () => {
    await api('/api/telemetry/error', {
      method: 'POST',
      body: { kind: 'error', message: 'ua check', agent: 'I-CLAIM-TO-BE-SOMEONE-ELSE' },
    });
    const row = rows().find((r) => r.message === 'ua check');
    assert.equal(row.agent, 'test-agent/1.0', 'a client must not be able to assert its own identity');
  });

  test('long fields are truncated at the handler, not trusted to be short', async () => {
    await api('/api/telemetry/error', {
      method: 'POST',
      body: { kind: 'error', message: 'x'.repeat(5000), source: 'y'.repeat(5000), path: 'z'.repeat(5000) },
    });
    const row = rows().find((r) => r.message.startsWith('xxx'));
    assert.equal(row.message.length, 500);
    assert.equal(row.source.length, 300);
    assert.equal(row.path.length, 200);
  });

  test('an unknown kind is dropped, and looks exactly like success', async () => {
    const before = rows().length;
    const r = await api('/api/telemetry/error', {
      method: 'POST', body: { kind: 'exfiltrate', message: 'nope' },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, {}, 'an identical body, so a prober learns nothing about the schema');
    assert.equal(rows().length, before, 'and nothing was stored');
  });

  test('a report with no session stores no user', async () => {
    assert.ok(rows().every((r) => r.user_id === null));
  });
});

describe('the door', () => {
  test('the limiter refuses in silence — the same 200 and the same body', async () => {
    // errorPerIp is 30/hour and several are already spent; push well past it.
    let lastBody = null;
    for (let i = 0; i < 40; i++) {
      const r = await api('/api/telemetry/error', {
        method: 'POST', body: { kind: 'error', message: `flood ${i}` },
      });
      assert.equal(r.status, 200, 'a 429 would tell a flooder its exact rate');
      lastBody = r.json;
    }
    assert.deepEqual(lastBody, {}, 'identical to a stored report');

    const flooded = rows().filter((r) => r.message.startsWith('flood ')).length;
    assert.ok(flooded < 40, `the limiter must actually drop some — stored ${flooded} of 40`);
  });

  test('the reader is operator-gated, and closed to an ordinary caller', async () => {
    assert.equal((await api('/api/telemetry/errors')).status, 401);
    const r = await api('/api/telemetry/errors', { auth: TOKEN });
    assert.equal(r.status, 200);
    assert.ok(r.json.recent.length > 0);
  });

  test('the reader leads with the number that means outage', async () => {
    const r = await api('/api/telemetry/errors', { auth: TOKEN });
    assert.equal(typeof r.json.blankLastHour, 'number');
    assert.ok(r.json.blankLastHour >= 1, 'a blank report in the last hour must be visible at the top');
    assert.equal(typeof r.json.errorsLastHour, 'number');
  });
});
