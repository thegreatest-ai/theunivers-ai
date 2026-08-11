#!/usr/bin/env node
/**
 * perf-measure — the evidence behind docs/design/PERFORMANCE.md, reproducible on demand.
 *
 * Three questions, because three separate things were wrong and each needs its own number:
 *
 *   1. What does the bundle weigh, chunk by chunk?
 *   2. What does a visitor to `/` download, and what does a visitor to `/app` download?
 *      Those are only different numbers if the build actually splits. ARCHITECTURE.md has always
 *      claimed `/app` loads no Three.js; until the routes were made lazy that was true of the
 *      source and false of the bundle, and only this measurement could tell the two apart.
 *   3. What actually leaves the server ON THE WIRE?
 *      A build tool's `gzip:` column is an estimate of what a compressing server WOULD send. It is
 *      not a measurement of ours, and for a long time ours sent none of it — the wire probe exists
 *      because that gap cost 942KB a visit and nothing in the build output showed it.
 *
 * Zero new dependencies: vite is already a devDependency, everything else is a node builtin.
 *
 *   node scripts/perf-measure.mjs             build, analyse, probe the wire
 *   node scripts/perf-measure.mjs --json      machine-readable, for diffing two runs
 *   node scripts/perf-measure.mjs --no-build  analyse the dist/ that is already there
 *   node scripts/perf-measure.mjs --no-wire   skip booting the server
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const args = new Set(process.argv.slice(2));
const JSON_OUT = args.has('--json');

const say = (...a) => { if (!JSON_OUT) console.log(...a); };
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
const pct = (a, b) => (b === 0 ? '—' : `${(((b - a) / b) * 100).toFixed(0)}%`);

/* ── 1. build, and keep the chunk graph ──────────────────────────────────────────────────── */

/**
 * The graph comes from rollup's own output rather than from parsing the built files, because only
 * rollup knows which imports are static (paid on arrival) and which are dynamic (paid on
 * navigation). That distinction IS the route-splitting measurement.
 */
async function buildAndGraph() {
  const { build } = await import('vite');
  const out = await build({ logLevel: 'silent' });
  const bundle = (Array.isArray(out) ? out[0] : out).output;
  const chunks = new Map();
  for (const c of bundle) {
    if (c.type !== 'chunk') continue;
    chunks.set(c.fileName, {
      fileName: c.fileName,
      isEntry: c.isEntry,
      imports: c.imports,                 // static — downloaded with whatever pulled them in
      dynamicImports: c.dynamicImports,   // lazy — downloaded only when that route is reached
      modules: Object.keys(c.modules ?? {}),
      // Vite splits a lazy route's CSS out with it, so app.css is only paid for under /app. It
      // belongs in the route's cost or the number flatters itself.
      css: [...(c.viteMetadata?.importedCss ?? [])],
    });
  }
  return chunks;
}

/** Every chunk you must have before the given ones can run: the static-import closure. */
function closure(chunks, seeds) {
  const seen = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f) || !chunks.has(f)) continue;
    seen.add(f);
    stack.push(...chunks.get(f).imports);
  }
  return seen;
}

/** Which chunk did a given source file end up in. How a route is located in the output. */
function chunkWith(chunks, suffix) {
  for (const c of chunks.values()) {
    if (c.modules.some((m) => m.endsWith(suffix))) return c.fileName;
  }
  return null;
}

/* ── 2. weigh what is on disk ────────────────────────────────────────────────────────────── */

const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.json', '.md', '.svg', '.txt']);

/**
 * Quality 9, not 11. Measured on this bundle: q11 is 287KB in 1706ms, q9 is 316KB in 41ms. The
 * server caches the result, so the cost is paid once per file per process either way — but it is
 * paid by whoever arrives first, and 1.7s of blocked event loop is a worse first visit than 28KB.
 */
const BR = { params: { [Z.BROTLI_PARAM_QUALITY]: 9 } };

function weigh(abs) {
  const bytes = readFileSync(abs);
  const compressible = COMPRESSIBLE.has(extname(abs));
  return {
    raw: bytes.length,
    gzip: compressible ? gzipSync(bytes, { level: 6 }).length : bytes.length,
    brotli: compressible ? brotliCompressSync(bytes, BR).length : bytes.length,
    compressible,
  };
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

/* ── 3. probe the wire ───────────────────────────────────────────────────────────────────── */

/**
 * node:http is used rather than fetch on purpose: fetch transparently decompresses, which would
 * report the size of what the browser ends up with instead of the size of what crossed the
 * network. Those two numbers differing by 4x is the entire point of this probe.
 */
function probe(port, path) {
  return new Promise((resolve, reject) => {
    const req = request(
      // agent:false — a pooled keep-alive socket outlives the measurement and holds this script
      // open after it has printed its results.
      { host: '127.0.0.1', port, path, agent: false, headers: { 'accept-encoding': 'gzip, br' } },
      (res) => {
        let wire = 0;
        res.on('data', (c) => { wire += c.length; });
        res.on('end', () => resolve({
          path,
          status: res.statusCode,
          wire,
          encoding: res.headers['content-encoding'] ?? null,
          cacheControl: res.headers['cache-control'] ?? null,
          etag: res.headers.etag ?? null,
        }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** A conditional re-request: what a returning visitor with a warm cache actually costs us. */
function probeIfNoneMatch(port, path, etag) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, agent: false, headers: { 'accept-encoding': 'gzip, br', 'if-none-match': etag } },
      (res) => {
        let wire = 0;
        res.on('data', (c) => { wire += c.length; });
        res.on('end', () => resolve({ path, status: res.statusCode, wire }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function withServer(fn) {
  const port = 8900 + Math.floor(Math.random() * 90);
  const data = mkdtempSync(join(tmpdir(), 'perf-'));
  const child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DB_PATH: join(data, 'perf.db'), INVITE_CODE: 'perf' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const h = await probe(port, '/api/health');
        if (h.status === 200) break;
      } catch { /* not listening yet */ }
      if (i === 99) throw new Error('server did not come up');
    }
    return await fn(port);
  } finally {
    child.kill();
  }
}

/* ── run ─────────────────────────────────────────────────────────────────────────────────── */

const report = { at: new Date().toISOString() };

let chunks = new Map();
if (!args.has('--no-build')) {
  say('building…');
  chunks = await buildAndGraph();
}
if (!existsSync(DIST)) {
  console.error('no dist/ — run without --no-build');
  process.exit(1);
}

/* Bundle table */
const files = walk(DIST).map((abs) => ({ name: relative(DIST, abs), ...weigh(abs) }))
  .sort((a, b) => b.raw - a.raw);
report.files = files;

say('\n── what is in dist/ ' + '─'.repeat(50));
say('  ' + 'file'.padEnd(34) + 'raw'.padStart(11) + 'gzip'.padStart(11) + 'brotli'.padStart(11));
for (const f of files) {
  say('  ' + f.name.padEnd(34) + kb(f.raw).padStart(11)
    + (f.compressible ? kb(f.gzip).padStart(11) + kb(f.brotli).padStart(11)
      : '—'.padStart(11) + '—'.padStart(11)));
}
const totals = files.reduce((a, f) => ({ raw: a.raw + f.raw, brotli: a.brotli + f.brotli }), { raw: 0, brotli: 0 });
report.total = totals;
say('  ' + 'TOTAL'.padEnd(34) + kb(totals.raw).padStart(11) + ''.padStart(11) + kb(totals.brotli).padStart(11));

/* Route cost */
if (chunks.size) {
  const weightOf = (name) => files.find((x) => x.name === name)?.brotli ?? 0;
  const sizeOf = (set) => [...set].reduce((n, f) => n + weightOf(f), 0);

  /** JS + the CSS that comes with it + index.html: everything a cold visit to a route pays. */
  const fullCost = (set) => {
    const css = new Set([...set].flatMap((f) => chunks.get(f)?.css ?? []));
    return sizeOf(set) + [...css].reduce((n, f) => n + weightOf(f), 0) + weightOf('index.html');
  };

  const entry = [...chunks.values()].find((c) => c.isEntry)?.fileName;
  const shared = closure(chunks, [entry]);

  const marketing = chunkWith(chunks, 'src/App.jsx');
  const app = chunkWith(chunks, 'src/app/Bridge.jsx');

  const costOf = (seed) => (seed ? closure(chunks, [entry, seed]) : shared);
  const routes = {
    '/ (marketing)': costOf(marketing),
    '/app (product)': costOf(app),
  };

  report.routes = {};
  say('\n── what a cold visit to each route downloads (brotli) ' + '─'.repeat(16));
  say('  ' + 'route'.padEnd(34) + 'JS'.padStart(11) + 'JS+CSS+HTML'.padStart(14));
  say('  ' + 'shared entry'.padEnd(34) + kb(sizeOf(shared)).padStart(11));
  for (const [name, set] of Object.entries(routes)) {
    report.routes[name] = { chunks: [...set], brotli: sizeOf(set), total: fullCost(set) };
    say('  ' + name.padEnd(34) + kb(sizeOf(set)).padStart(11) + kb(fullCost(set)).padStart(14)
      + `  (${set.size} chunk(s))`);
  }

  /*
   * The claim that must not silently stop being true. ARCHITECTURE.md says `/app` loads no
   * Three.js; this is the assertion that keeps the document honest, and it fails the run rather
   * than quietly printing a bigger number.
   */
  const appChunks = routes['/app (product)'];
  const heavy = ['three', 'postprocessing', '@react-three', 'lenis', 'maath'];
  const leaked = [...appChunks].flatMap((f) => (chunks.get(f)?.modules ?? [])
    .filter((m) => heavy.some((h) => m.includes(`node_modules/${h}`))));
  report.threeInApp = leaked.length;
  if (leaked.length) {
    say(`\n  ✗ /app pulls in ${leaked.length} module(s) of the marketing 3D stack`);
    if (!args.has('--allow-three-in-app')) process.exitCode = 1;
  } else {
    say('\n  ✓ /app carries none of three / drei / postprocessing / lenis / maath');
  }
}

/* Wire probe */
if (!args.has('--no-wire')) {
  say('\n── what the server actually sends ' + '─'.repeat(36));
  const js = files.find((f) => f.name.endsWith('.js') && f.name.startsWith('assets/'));
  const css = files.find((f) => f.name.endsWith('.css'));
  const img = files.find((f) => f.name.endsWith('.jpg'));
  const paths = ['/', `/${js?.name}`, `/${css?.name}`, `/${img?.name}`].filter(Boolean);

  report.wire = await withServer(async (port) => {
    const rows = [];
    for (const p of paths) {
      const r = await probe(port, p);
      if (r.etag) r.revalidate = (await probeIfNoneMatch(port, p, r.etag)).status;
      rows.push(r);
    }
    return rows;
  });

  say('  ' + 'path'.padEnd(34) + 'wire'.padStart(11) + '  enc     cache-control');
  for (const r of report.wire) {
    say('  ' + r.path.slice(0, 33).padEnd(34) + kb(r.wire).padStart(11)
      + `  ${(r.encoding ?? 'none').padEnd(7)} ${r.cacheControl ?? '(none)'}`
      + (r.revalidate ? `  · re-request ${r.revalidate}` : ''));
  }

  const jsRow = report.wire.find((r) => r.path.endsWith('.js'));
  const jsFile = files.find((f) => `/${f.name}` === jsRow?.path);
  if (jsRow && jsFile) {
    say(`\n  entry JS on the wire: ${kb(jsRow.wire)} of ${kb(jsFile.raw)} raw — ${pct(jsRow.wire, jsFile.raw)} saved`);
  }
}

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
