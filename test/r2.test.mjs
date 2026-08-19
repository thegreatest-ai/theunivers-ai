/**
 * R2 media: the volume stays the default, the bucket is a secret away.
 *
 * Credentials choose the provider. Serving stays on our origin because img-src is 'self'.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signedHeaders, configured, r2Credentials } from '../server/r2.mjs';
import * as r2 from '../server/r2.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INDEX = readFileSync(join(ROOT, 'server', 'index.mjs'), 'utf8');
const CSP = readFileSync(join(ROOT, 'shared', 'csp.mjs'), 'utf8');
const STORAGE = readFileSync(join(ROOT, 'server', 'storage.mjs'), 'utf8');

test('one missing R2 variable is not a configured bucket', () => {
  const keys = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    assert.equal(configured(), false);
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'id';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    assert.equal(configured(), false, 'three of four is still the volume');
    process.env.R2_BUCKET = 'media';
    assert.equal(configured(), true);
    assert.equal(r2Credentials().endpoint, 'https://acct.r2.cloudflarestorage.com');
    process.env.R2_ENDPOINT = 'http://127.0.0.1:9/';
    assert.equal(r2Credentials().endpoint, 'http://127.0.0.1:9', 'trailing slash is stripped');
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

test('Sig v4 is stable for a fixed clock and an empty payload', () => {
  const credentials = {
    accountId: 'acct', accessKey: 'AKIAEXAMPLE',
    secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    bucket: 'media', endpoint: 'https://acct.r2.cloudflarestorage.com',
  };
  const headers = signedHeaders({
    method: 'GET',
    url: 'https://acct.r2.cloudflarestorage.com/media/ab/med_test',
    bodyHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    at: new Date('2026-08-19T12:00:00.000Z'),
    credentials,
  });
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20260819\/auto\/s3\/aws4_request/);
  assert.match(headers.authorization,
    /Signature=950a1e0d2cb6a8c928f17ebfa9178449f5e5eba2d985bac5b251fe0950767f8e$/);
  assert.equal(headers['x-amz-date'], '20260819T120000Z');
});

test('the page never talks to R2, and GET /api/media never 302s off-origin', () => {
  assert.doesNotMatch(CSP, /r2\.cloudflarestorage\.com/);
  const start = INDEX.indexOf("route('GET', '/api/media/:id'");
  const next = INDEX.indexOf("\nroute('", start + 1);
  const route = INDEX.slice(start, next);
  assert.match(route, /async \(ctx\)/);
  assert.match(route, /await store\.get/);
  assert.doesNotMatch(route, /__redirect/);
  assert.match(route, /nosniff/);
  assert.match(route, /content-disposition': 'inline'/);
  assert.match(STORAGE, /r2\.configured\(\)/);
  assert.match(STORAGE, /Local first/);
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function fakeS3() {
  const objects = new Map();
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const parts = new URL(req.url, 'http://s3.test').pathname.split('/').filter(Boolean);
      const key = parts.slice(1).map(decodeURIComponent).join('/');
      if (req.method === 'PUT') {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method === 'GET') {
        const body = objects.get(key);
        if (!body) { res.writeHead(404); res.end(); return; }
        res.writeHead(200);
        res.end(body);
        return;
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(405);
      res.end();
    });
  });
  return { server, objects };
}

describe('put, get and remove against a fake bucket', () => {
  let s3; let port;
  const keep = {};

  before(async () => {
    s3 = fakeS3();
    port = await listen(s3.server);
    for (const [k, v] of Object.entries({
      R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'media', R2_ENDPOINT: `http://127.0.0.1:${port}`,
    })) {
      keep[k] = process.env[k];
      process.env[k] = v;
    }
  });

  after(() => {
    s3.server.close();
    for (const [k, v] of Object.entries(keep)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('a put is retrievable and a remove is gone', async () => {
    assert.equal(configured(), true);
    const key = 'ab/med_r2test';
    const payload = Buffer.from('the photograph');
    await r2.put(key, payload, 'image/jpeg');
    assert.equal(s3.objects.get(key).equals(payload), true);
    const got = await r2.get(key);
    assert.equal(got.equals(payload), true);
    await r2.remove(key);
    assert.equal(s3.objects.has(key), false);
    assert.equal(await r2.get(key), null);
  });
});

describe('the app stores on R2 and still serves from its own origin', () => {
  const TOKEN = { ana: 'tok_r2_ana' };
  let PORT; let child; let DB; let MEDIA; let s3; let s3Port;

  function api(path, { method = 'GET', as, body, raw, type } = {}) {
    return new Promise((resolve, reject) => {
      const payload = raw ?? (body === undefined ? null : JSON.stringify(body));
      const req = request({
        host: '127.0.0.1', port: PORT, path, method, agent: false,
        headers: {
          ...(as ? { Authorization: `Bearer ${TOKEN[as]}` } : {}),
          ...(payload ? {
            'content-type': type || 'application/json',
            'content-length': Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload),
          } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try { json = JSON.parse(buf.toString('utf8')); } catch { /* bytes */ }
          resolve({ status: res.statusCode, json, buf, headers: res.headers });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  before(async () => {
    s3 = fakeS3();
    s3Port = await listen(s3.server);
    PORT = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'r2-media-'));
    DB = join(dir, 'r2.db');
    MEDIA = join(dir, 'media');
    child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      env: {
        ...process.env, PORT: String(PORT), DB_PATH: DB, MEDIA_PATH: MEDIA,
        INVITE_CODE: 'r2-test', OAUTH_STATE_SECRET: 'r2-secret',
        R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret',
        R2_BUCKET: 'media', R2_ENDPOINT: `http://127.0.0.1:${s3Port}`,
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
    db.prepare('INSERT INTO user (id,email,name,created_at) VALUES (?,?,?,?)')
      .run('usr_ana', 'ana@example.test', 'ana', t);
    db.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)')
      .run(TOKEN.ana, 'usr_ana', t);
    db.close();
  });

  after(() => {
    child?.kill();
    s3?.server.close();
  });

  test('an upload lands in the bucket, not on the volume, and GET is still our origin', async () => {
    const made = await api('/api/works', {
      method: 'POST', as: 'ana',
      body: { kind: 'photo', title: 'r2', ratio: '1:1' },
    });
    assert.equal(made.status, 200, made.json && JSON.stringify(made.json));
    const payload = Buffer.alloc(2048, 9);
    const up = await api(`/api/works/${made.json.work.id}/media`, {
      method: 'POST', as: 'ana', raw: payload, type: 'image/jpeg',
    });
    assert.equal(up.status, 200, up.buf.toString());
    const url = up.json.media.url;
    assert.match(url, /^\/api\/media\//, 'the client still loads from our origin');

    const db = new DatabaseSync(DB);
    const [row] = db.prepare('SELECT path FROM media WHERE id = ?').all(up.json.media.id);
    db.close();
    assert.equal(existsSync(join(MEDIA, row.path)), false,
      'a configured bucket must not keep filling the volume');
    const stored = [...s3.objects.values()].find((b) => b.equals(payload));
    assert.ok(stored, 'the bytes must be in the bucket');

    const got = await api(url, { as: 'ana' });
    assert.equal(got.status, 200);
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.equal(got.headers['content-disposition'], 'inline');
    assert.equal(got.headers['cache-control'], 'private, no-store');
    assert.equal(got.buf.equals(payload), true);
  });
});
