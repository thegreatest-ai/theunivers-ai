/**
 * How bytes leave the server.
 *
 * These are performance tests, but two of them are security tests wearing a performance hat: the
 * static layer gained compression and caching, and `/api/media` must have gained NEITHER. A
 * cached medium outlives its signed link, and that is the whole point of the link being signed.
 *
 * The regression each one guards has already happened once:
 *   · nothing was compressed at all — 1228KB of JavaScript on the wire, per visit
 *   · nothing carried a cache header — the same 1228KB again on the next visit
 * Both were invisible in `vite build`, whose "gzip:" column describes a server we did not have.
 *
 * `scripts/perf-measure.mjs` produces the numbers; this decides whether they are still true.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/**
 * Ask the OS for a port nobody is using, rather than guessing one.
 *
 * This was `8700 + random(200)`, which collides: `node --test test/*.test.mjs` runs the files in
 * PARALLEL, so a 1-in-200 guess is drawn repeatedly, and the loser's server dies on EADDRINUSE.
 * Binding port 0 and reading back what we were given makes the collision impossible rather than
 * unlikely. There is a gap between closing this socket and the server claiming the port, but it is
 * microseconds against the seconds-wide window a random guess leaves open.
 */
async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let PORT;
let child;
const built = existsSync(join(DIST, 'index.html'));

/** Raw node:http, not fetch: fetch decompresses, which hides the number under test. */
function hit(path, { headers = {}, method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: PORT, path, method, agent: false,
        headers: { 'accept-encoding': 'gzip, br', ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          wire: Buffer.concat(chunks).length,
          text: () => Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  PORT = await freePort();
  const data = mkdtempSync(join(tmpdir(), 'serving-'));
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: join(data, 'test.db'),
           INVITE_CODE: 'serving-test', OAUTH_STATE_SECRET: 'test-secret' },
    // KEEP stderr. This was `stdio: 'ignore'`, which threw away the one thing that explains a
    // failure: a server that crashed on startup and a server that is merely slow both presented
    // as "server did not start" after a silent ten-second wait.
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  // Notice a dead child IMMEDIATELY instead of waiting out the whole budget for a process that is
  // never coming back.
  let exited = null;
  child.on('exit', (code, signal) => { exited = { code, signal }; });

  /*
   * The budget is generous because this suite runs in PARALLEL with a headless-Chrome test that
   * saturates the CPU; a boot that takes 300ms alone can take several seconds under that load.
   * The old 10s budget failed roughly one run in three once the browser test joined the suite —
   * and a flaky check that gates deployment is worse than no check, because it teaches you to
   * re-run until green.
   */
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `the server exited during startup (code ${exited.code}, signal ${exited.signal})` +
        (stderr.trim() ? `:\n${stderr.trim()}` : ' with nothing on stderr'),
      );
    }
    try { if ((await hit('/api/health')).status === 200) return; } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error(
    `server did not answer /api/health on port ${PORT} within 60s` +
    (stderr.trim() ? `. stderr:\n${stderr.trim()}` : '. stderr was empty'),
  );
});

after(() => child?.kill());

/* ── static: compressed ──────────────────────────────────────────────────────────────────── */

test('JavaScript is compressed when the browser accepts it', { skip: !built }, async () => {
  const name = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.js'));
  const res = await hit(`/assets/${name}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-encoding'], 'br');
  // The entry chunk is six figures of raw bytes; anything near that means it went out plain.
  assert.ok(res.wire < 400_000, `entry chunk went out at ${res.wire} bytes`);
});

test('a client that accepts nothing still gets a working, uncompressed answer', { skip: !built }, async () => {
  const name = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.js'));
  const res = await hit(`/assets/${name}`, { headers: { 'accept-encoding': '' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-encoding'], undefined);
});

test('gzip is offered to a client that cannot take brotli', { skip: !built }, async () => {
  const name = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.js'));
  const res = await hit(`/assets/${name}`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(res.headers['content-encoding'], 'gzip');
});

test('images are not run through the compressor', { skip: !built }, async () => {
  const jpg = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.jpg'));
  if (!jpg) return;
  const res = await hit(`/assets/${jpg}`);
  // Already-compressed bytes only get bigger, and the CPU is spent for nothing.
  assert.equal(res.headers['content-encoding'], undefined);
});

test('Vary: Accept-Encoding is set, so a shared cache cannot mix up encodings', { skip: !built }, async () => {
  const name = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.js'));
  const res = await hit(`/assets/${name}`);
  assert.match(String(res.headers.vary ?? ''), /accept-encoding/i);
});

/* ── static: cached ──────────────────────────────────────────────────────────────────────── */

test('a content-hashed asset may be kept for a year', { skip: !built }, async () => {
  const name = readdirSync(join(DIST, 'assets')).find((f) => /-[A-Za-z0-9_-]{8}\.js$/.test(f));
  const res = await hit(`/assets/${name}`);
  assert.match(res.headers['cache-control'], /immutable/);
});

test('an asset copied verbatim from public/ is NOT immutable', { skip: !built }, async () => {
  // nebula.jpg keeps its name across a rebuild, so a year-long immutable cache would pin a stale
  // copy in every browser that ever loaded it.
  const jpg = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.jpg'));
  if (!jpg) return;
  const res = await hit(`/assets/${jpg}`);
  assert.doesNotMatch(res.headers['cache-control'] ?? '', /immutable/);
});

test('index.html is never cached — it names the hashed assets', { skip: !built }, async () => {
  const res = await hit('/');
  assert.match(res.headers['cache-control'], /no-cache/);
});

test('a returning visitor gets a 304 and no body', { skip: !built }, async () => {
  const jpg = readdirSync(join(DIST, 'assets')).find((f) => f.endsWith('.jpg'));
  if (!jpg) return;
  const first = await hit(`/assets/${jpg}`);
  assert.ok(first.headers.etag, 'no ETag to revalidate with');
  const again = await hit(`/assets/${jpg}`, { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.wire, 0);
  assert.ok(first.wire > 100_000, 'the image under test should be large enough to matter');
});

test('the SPA fallback still serves /app/* as index.html', { skip: !built }, async () => {
  const res = await hit('/app/deals');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
});

/* ── media: none of the above may have leaked in ─────────────────────────────────────────── */

test('an uploaded file keeps every header that protects it', async () => {
  const email = `perf${Date.now()}@example.com`;
  const reg = await hit('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'A-long-enough-passphrase-9', inviteCode: 'serving-test' }),
  });
  assert.equal(reg.status, 200, reg.text());
  const { sessionToken: token } = JSON.parse(reg.text());

  const work = await hit('/api/works', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind: 'photo', title: 'perf.jpg' }),
  });
  assert.equal(work.status, 200, work.text());
  const workId = JSON.parse(work.text()).work.id;

  const up = await hit(`/api/works/${workId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${token}`, 'x-filename': 'perf.jpg' },
    body: Buffer.alloc(64_000, 7),
  });
  assert.equal(up.status, 200, up.text());
  const { url } = JSON.parse(up.text()).media;

  const res = await hit(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['content-disposition'], 'inline');
  // The static layer's caching must not have reached this route: a stored copy outlives the
  // signed link, which is the one thing the signature exists to prevent.
  assert.match(res.headers['cache-control'], /no-store/);
  assert.equal(res.headers.etag, undefined);
});

test('an unsigned media request is still refused', async () => {
  const res = await hit('/api/media/med_whatever');
  assert.equal(res.status, 401);
});
