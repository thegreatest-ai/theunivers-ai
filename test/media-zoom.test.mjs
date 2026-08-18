/**
 * Zoom is per image, inside the post's frame. The bytes are never touched.
 *
 * HTTP tests prove the gate: out of range is a 400 (never a clamp), omitted is untouched,
 * the eleventh picture is a 409. Source-reading tests prove the surfaces: cropped cells
 * apply cropStyle, WorkDetail does not — a zoomed detail view would make the original
 * unreachable, which is the one thing this design exists to prevent.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseZoom, parseFocal, cropStyle, MEDIA_CAP, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT,
  FOCAL_DEFAULT,
} from '../shared/media-zoom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOK = { ana: 'tok_z_ana' };

describe('parse: out of range is an error, never a clamp', () => {
  test('omitted zoom is untouched (1)', () => {
    assert.deepEqual(parseZoom(undefined), { value: ZOOM_DEFAULT });
    assert.deepEqual(parseZoom(null), { value: ZOOM_DEFAULT });
    assert.deepEqual(parseZoom(''), { value: ZOOM_DEFAULT });
  });

  test('1 and 3 are accepted; 0.99 and 3.01 are not', () => {
    assert.deepEqual(parseZoom(1), { value: 1 });
    assert.deepEqual(parseZoom(3), { value: 3 });
    assert.deepEqual(parseZoom('1.5'), { value: 1.5 });
    assert.equal(parseZoom(0.99).error, 'zoom must be between 1 and 3');
    assert.equal(parseZoom(3.01).error, 'zoom must be between 1 and 3');
    assert.equal(parseZoom(0).error, 'zoom must be between 1 and 3');
    assert.equal(parseZoom(4).error, 'zoom must be between 1 and 3');
    assert.equal(parseZoom('nope').error, 'zoom must be between 1 and 3');
    // A clamp would have returned 1 or 3. Returning error is the whole point.
    assert.equal(parseZoom(0.5).value, undefined);
    assert.equal(parseZoom(9).value, undefined);
  });

  test('omitted focal is centre (50); 0 and 100 are accepted', () => {
    assert.deepEqual(parseFocal(undefined), { value: FOCAL_DEFAULT });
    assert.deepEqual(parseFocal(0, 'focal_x'), { value: 0 });
    assert.deepEqual(parseFocal(100, 'focal_y'), { value: 100 });
    assert.equal(parseFocal(-0.1, 'focal_x').error, 'focal_x must be between 0 and 100');
    assert.equal(parseFocal(100.1, 'focal_y').error, 'focal_y must be between 0 and 100');
    assert.equal(parseFocal(-1, 'focal_x').value, undefined);
    assert.equal(parseFocal(101, 'focal_y').value, undefined);
  });

  test('the cap is ten, named', () => {
    assert.equal(MEDIA_CAP, 10);
    assert.equal(ZOOM_MIN, 1);
    assert.equal(ZOOM_MAX, 3);
  });
});

describe('cropStyle: untouched applies nothing', () => {
  test('1 and 50/50 return undefined, so absent stays absent', () => {
    assert.equal(cropStyle({ zoom: 1, focal_x: 50, focal_y: 50 }), undefined);
    assert.equal(cropStyle({ zoom: 1 }), undefined);
    assert.equal(cropStyle({}), undefined);
    assert.equal(cropStyle(null), undefined);
  });

  test('a zoom becomes transform:scale, a focal becomes object-position', () => {
    assert.deepEqual(cropStyle({ zoom: 2 }), { transform: 'scale(2)' });
    assert.deepEqual(cropStyle({ zoom: 1, focal_x: 20, focal_y: 80 }), {
      objectPosition: '20% 80%',
    });
    assert.deepEqual(cropStyle({ zoom: 1.5, focal_x: 0, focal_y: 100 }), {
      transform: 'scale(1.5)',
      objectPosition: '0% 100%',
    });
  });
});

describe('the surfaces: zoom is a crop, WorkDetail is the original', () => {
  test('WorkDetail does not apply zoom — keep the original detail', () => {
    // A zoomed detail view would quietly make the original unreachable, which is the one
    // thing this whole design exists to prevent. Asserted because it is the invariant
    // most easily lost: cropStyle is one import away and looks like the obvious thing.
    const src = read('src/app/WorkDetail.jsx');
    assert.match(src, /keep the original detail/);
    assert.doesNotMatch(src, /cropStyle/);
    assert.doesNotMatch(src, /media-zoom/);
    assert.doesNotMatch(src, /scale\(/);
    assert.doesNotMatch(src, /objectPosition/);
    assert.doesNotMatch(src, /current\.zoom|\.zoom\b/);
  });

  test('the profile grid and the feed apply cropStyle; the grid keeps its own shape', () => {
    assert.match(read('src/app/Works.jsx'), /cropStyle/, 'the square cell still frames');
    assert.match(read('src/app/Discover.jsx'), /cropStyle/, 'the feed cell still frames');
    assert.match(read('src/app/Works.jsx'), /from '\.\.\/\.\.\/shared\/media-zoom\.mjs'/);
    assert.match(read('src/app/Discover.jsx'), /from '\.\.\/\.\.\/shared\/media-zoom\.mjs'/);
    const works = read('src/app/Works.jsx');
    assert.doesNotMatch(works, /cellAspect/, 'cdda5cb: the grid must not consult a per-post ratio');
    assert.doesNotMatch(works, /aspectRatio/, 'cdda5cb: no inline per-cell shape');
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-shot\{[^}]*aspect-ratio:3\/4/s);
    assert.match(css, /\.wk-shot\{[^}]*overflow:hidden/s,
      'a scaled image must clip to the cell, not escape it');
  });

  test('Add more appends and never replaces', () => {
    const src = read('src/app/CreatePost.jsx');
    assert.match(src, /Add more/);
    const addAt = src.indexOf('function addMore');
    assert.ok(addAt > 0, 'there must be an addMore path');
    const addMore = src.slice(addAt, src.indexOf('\n  function onPick'));
    assert.doesNotMatch(addMore, /revokeObjectURL/,
      'adding more must not throw away the pictures already chosen');
    assert.match(src, /take\(list, \{ append \}\)/);
    const takeAt = src.indexOf('function take');
    const take = src.slice(takeAt, src.indexOf('\n  function addMore'));
    assert.match(take, /append/, 'the picker has a path that concatenates');
    assert.match(take, /itemsRef\.current, \.\.\.added/, 'new files land after the ones already chosen');
    // Absent, not disabled, when the kind cannot take more than one (video, threads).
    assert.match(src, /multiple && !atCap/);
    assert.match(src, /Remove this picture/, 'a way in with no way out is how people cancel the window');
    assert.match(src, /A post can hold \$\{MEDIA_CAP\} pictures/);
  });

  test('zoom controls are labelled and only on photo and video', () => {
    const src = read('src/app/CreatePost.jsx');
    assert.match(src, /const zoomable = kind === 'photo' \|\| kind === 'video'/);
    assert.match(src, /\{zoomable && \(/);
    assert.match(src, /sr-only">Zoom out/);
    assert.match(src, /sr-only">Zoom in/);
    assert.match(src, /aria-label="Zoom"/);
    assert.match(src, /type="range"/);
  });
});

let PORT; let child; let DB;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function api(path, { method = 'GET', as, body, raw, type, headers: extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw ?? (body === undefined ? null : JSON.stringify(body));
    const auth = as ? TOK[as] : null;
    const req = request({
      host: '127.0.0.1', port: PORT, path, method, agent: false,
      headers: {
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...(payload ? {
          'content-type': type || (raw ? 'application/octet-stream' : 'application/json'),
          'content-length': Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload),
        } : {}),
        ...extra,
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

const BYTES = Buffer.alloc(4096, 7);

async function photoWork(title = 'framed') {
  const r = await api('/api/works', {
    method: 'POST', as: 'ana', body: { kind: 'photo', title },
  });
  assert.equal(r.status, 200, r.text);
  return r.json.work;
}

async function upload(workId, extra = {}) {
  return api(`/api/works/${workId}/media`, {
    method: 'POST', as: 'ana', raw: BYTES, type: 'image/jpeg', headers: extra,
  });
}

describe('the server is the gate', () => {
  before(async () => {
    PORT = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'media-zoom-'));
    DB = join(dir, 'media-zoom.db');
    const media = join(dir, 'media');
    child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DB_PATH: DB, MEDIA_PATH: media,
             INVITE_CODE: 'media-zoom-test', OAUTH_STATE_SECRET: 'media-zoom-secret' },
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
      .run(TOK.ana, 'usr_ana', t);
    db.close();
  });

  after(() => child?.kill());

  test('zoom out of range is a 400, and nothing is stored', async () => {
    const w = await photoWork('bad zoom');
    for (const zoom of ['0.5', '0', '3.01', '4', 'nope']) {
      const r = await upload(w.id, { 'x-zoom': zoom });
      assert.equal(r.status, 400, `zoom=${zoom} must 400, got ${r.status} ${r.text}`);
      assert.match(r.text, /zoom must be between 1 and 3/);
    }
    assert.equal(rows('SELECT id FROM media WHERE work_id = ?', w.id).length, 0,
      'a refused zoom must not have created a row — that would be a clamp by another name');
  });

  test('focal out of range is a 400, and nothing is stored', async () => {
    const w = await photoWork('bad focal');
    const x = await upload(w.id, { 'x-focal-x': '-1' });
    assert.equal(x.status, 400, x.text);
    assert.match(x.text, /focal_x must be between 0 and 100/);
    const y = await upload(w.id, { 'x-focal-y': '101' });
    assert.equal(y.status, 400, y.text);
    assert.match(y.text, /focal_y must be between 0 and 100/);
    assert.equal(rows('SELECT id FROM media WHERE work_id = ?', w.id).length, 0);
  });

  test('1 and 3 and 50/50 round-trip; omitted is untouched', async () => {
    const w = await photoWork('defaults');
    const omitted = await upload(w.id);
    assert.equal(omitted.status, 200, omitted.text);
    assert.equal(omitted.json.media.zoom, 1);
    assert.equal(omitted.json.media.focal_x, 50);
    assert.equal(omitted.json.media.focal_y, 50);

    const framed = await upload(w.id, {
      'x-zoom': '2.5', 'x-focal-x': '0', 'x-focal-y': '100',
    });
    assert.equal(framed.status, 200, framed.text);
    assert.equal(framed.json.media.zoom, 2.5);
    assert.equal(framed.json.media.focal_x, 0);
    assert.equal(framed.json.media.focal_y, 100);

    const edge = await upload(w.id, { 'x-zoom': '3' });
    assert.equal(edge.status, 200, edge.text);
    assert.equal(edge.json.media.zoom, 3);

    const got = await api(`/api/works/${w.id}`, { as: 'ana' });
    assert.equal(got.status, 200, got.text);
    assert.equal(got.json.work.media[0].zoom, 1);
    assert.equal(got.json.work.media[0].focal_x, 50);
    assert.equal(got.json.work.media[0].focal_y, 50);
    assert.equal(got.json.work.media[1].zoom, 2.5);
    assert.equal(got.json.work.media[2].zoom, 3);
  });

  test('a row that predates these columns reads as untouched', async () => {
    const w = await photoWork('legacy');
    const t = new Date().toISOString();
    const db = new DatabaseSync(DB);
    db.prepare(`INSERT INTO media (id, work_id, user_id, mime, kind, bytes, path, filename, ordinal, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('med_legacy', w.id, 'usr_ana', 'image/jpeg', 'image', 12, 'xx/legacy', 'old.jpg', 0, t);
    db.close();
    const [row] = rows('SELECT zoom, focal_x, focal_y FROM media WHERE id = ?', 'med_legacy');
    assert.equal(row.zoom, 1);
    assert.equal(row.focal_x, 50);
    assert.equal(row.focal_y, 50);
    const got = await api(`/api/works/${w.id}`, { as: 'ana' });
    assert.equal(got.json.work.media[0].zoom, 1);
    assert.equal(got.json.work.media[0].focal_x, 50);
    assert.equal(got.json.work.media[0].focal_y, 50);
  });

  test('the eleventh image is a 409, and the tenth is not', async () => {
    const w = await photoWork('cap');
    for (let i = 0; i < MEDIA_CAP; i++) {
      const r = await upload(w.id);
      assert.equal(r.status, 200, `picture ${i + 1} must land, got ${r.status} ${r.text}`);
    }
    const eleventh = await upload(w.id);
    assert.equal(eleventh.status, 409, eleventh.text);
    assert.match(eleventh.text, /10/, 'the refusal must name the limit');
    assert.equal(rows('SELECT id FROM media WHERE work_id = ?', w.id).length, MEDIA_CAP);
  });
});
