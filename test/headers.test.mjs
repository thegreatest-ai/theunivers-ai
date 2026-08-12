/**
 * The response headers, pinned.
 *
 * A Content-Security-Policy is the one security control that fails INVISIBLY in both directions:
 * too loose and nothing complains, too tight and the page sits on "Loading…" while the server
 * answers 200 and looks healthy. So the origins the product actually loads are asserted here by
 * name — if someone adds a CDN and not the directive, this fails before a user finds a blank page.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let PORT; let child;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function head(path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method: 'GET', agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  PORT = await freePort();
  const DB = join(mkdtempSync(join(tmpdir(), 'headers-')), 'headers.db');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    // A real origin, because an empty string cannot be used to test the fallback: env.mjs applies
    // .env with 'if (!process.env[key])', and '' is falsy, so the local .env's CORS_ORIGIN=* wins.
    // What this pins is that the header REFLECTS configuration and is never hardcoded to '*'.
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, INVITE_CODE: 'headers-test',
           OAUTH_STATE_SECRET: 'headers-secret', CORS_ORIGIN: 'https://headers.test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  let exited = null; child.on('exit', (c) => { exited = c; });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited !== null) throw new Error(`server exited: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`server did not start: ${stderr}`);
    try { if ((await head('/api/health')).status === 200) break; } catch { /* not up */ }
    await sleep(100);
  }
});

after(() => child?.kill());

describe('security headers', () => {
  test('every response carries them, api and asset alike', async () => {
    const r = await head('/api/health');
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.ok(r.headers['content-security-policy'], 'no CSP on an API response');
  });

  test('scripts are same-origin only, with no inline concession', async () => {
    const csp = (await head('/api/health')).headers['content-security-policy'];
    assert.match(csp, /script-src 'self'(;|$)/,
      "script-src must not gain 'unsafe-inline' — give a future inline script a nonce instead");
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
  });

  test('the origins the product really loads are declared', async () => {
    const csp = (await head('/api/health')).headers['content-security-policy'];
    // index.html links the Google Fonts stylesheet; App.jsx:10 pulls three.js planet textures.
    // Environment HDR is same-origin (/assets/hdri/…) — do not reopen githack/githubusercontent.
    assert.ok(csp.includes('https://fonts.googleapis.com'), 'the font stylesheet would be blocked');
    assert.ok(csp.includes('https://fonts.gstatic.com'), 'the font files would be blocked');
    assert.ok(csp.includes('https://cdn.jsdelivr.net'), 'the marketing page textures would be blocked');
    assert.equal(csp.includes('raw.githack.com'), false,
      'Environment HDR is local; githack must stay out of CSP');
    assert.equal(csp.includes('raw.githubusercontent.com'), false,
      'do not open connect-src for a CDN that githack redirects into');
  });

  test('React inline styles are allowed, because style attributes are how it renders', async () => {
    const csp = (await head('/api/health')).headers['content-security-policy'];
    assert.match(csp, /style-src [^;]*'unsafe-inline'/);
  });
});

describe('cross-origin default', () => {
  test('the fallback is our own origin, never the whole internet', async () => {
    const origin = (await head('/api/health')).headers['access-control-allow-origin'];
    assert.equal(origin, 'https://headers.test', 'the configured origin must be what is sent');
    assert.notEqual(origin, '*',
      'a default of "anyone" stops being harmless the first time a cookie appears, and nobody ' +
      're-reads a header they have already seen work');
    assert.match(origin, /^https?:\/\//, 'it must still be a usable origin, not empty');
  });
});
