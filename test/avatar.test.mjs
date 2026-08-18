/**
 * Avatar upload: a photograph of the person, not initials.
 *
 * The properties that matter more than the rest, because getting any of them wrong is worse
 * than shipping initials:
 *
 *   AN AVATAR IS NOT A WORK. A fake photo-work would put a face in the 3:4 grid.
 *   ABSENT IS INITIALS, NEVER A STOCK FACE. Null must stay null.
 *   REPLACE DELETES THE PREVIOUS FILE. Nothing cites an avatar, so the bytes go.
 *   NEVER A PROVIDER PICTURE URL. The page talks to no external hosts.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOK = { ana: 'tok_av_ana', ben: 'tok_av_ben' };
const AGENT = { ana: 'tok_agent_av_ana', ben: 'tok_agent_av_ben' };
const ID = { ana: 'usr_ana', ben: 'usr_ben' };

const SERVER = readFileSync(join(ROOT, 'server', 'index.mjs'), 'utf8');
const DB_SRC = readFileSync(join(ROOT, 'server', 'db.mjs'), 'utf8');
const OAUTH = readFileSync(join(ROOT, 'server', 'oauth.mjs'), 'utf8');
const YOU = readFileSync(join(ROOT, 'src', 'app', 'You.jsx'), 'utf8');
const PERSON = readFileSync(join(ROOT, 'src', 'app', 'Person.jsx'), 'utf8');
const AVATAR = readFileSync(join(ROOT, 'src', 'app', 'Avatar.jsx'), 'utf8');
const SETTINGS = readFileSync(join(ROOT, 'src', 'app', 'Settings.jsx'), 'utf8');

let PORT; let child; let DB; let MEDIA;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function png(w, h) {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
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
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, text, buf, headers: res.headers });
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
  const dir = mkdtempSync(join(tmpdir(), 'avatar-'));
  DB = join(dir, 'avatar.db');
  MEDIA = join(dir, 'media');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, MEDIA_PATH: MEDIA,
           INVITE_CODE: 'avatar-test', OAUTH_STATE_SECRET: 'avatar-secret' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  let exited = null;
  child.on('exit', (code) => { exited = code; });
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
    db.prepare('INSERT INTO user (id, email, name, created_at) VALUES (?,?,?,?)')
      .run(ID[who], `${who}@example.test`, who === 'ana' ? 'Ana' : 'Ben', t);
    db.prepare('INSERT INTO session (token, user_id, created_at) VALUES (?,?,?)')
      .run(TOK[who], ID[who], t);
    db.prepare(`INSERT INTO agent (id, user_id, name, purpose, api_token, created_at)
                VALUES (?,?,?,?,?,?)`)
      .run(`agt_${who}`, ID[who], `${who}.works`, 'acts on my behalf', AGENT[who], t);
  }
  db.close();
});

after(() => child?.kill());

describe('the schema', () => {
  test('media.work_id is nullable, so an avatar does not need a fake work', () => {
    const info = rows('PRAGMA table_info(media)');
    const work = info.find((c) => c.name === 'work_id');
    assert.ok(work, 'media.work_id exists');
    assert.equal(work.notnull, 0, 'NULL is what makes an avatar a media row that is not a slide');
    assert.match(DB_SRC, /work_id\s+TEXT REFERENCES work\(id\)/,
      'fresh CREATE TABLE must match, or new databases rebuild on every boot');
  });
});

describe('upload and read', () => {
  test('a person with no photograph has avatar null, not a guessed path', async () => {
    const r = await api('/api/people/usr_ana', { as: 'ben' });
    assert.equal(r.status, 200);
    assert.equal(r.json.person.avatar, null);
    assert.equal(r.json.person.email, undefined, 'email is still nobody else\'s business');
  });

  test('uploading a PNG returns a signed URL, and fetching it returns the bytes', async () => {
    const body = png(200, 200);
    const r = await api('/api/profile/avatar', {
      method: 'POST', as: 'ana', raw: body, type: 'image/png',
    });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.person.avatar?.id);
    assert.match(r.json.person.avatar.url, /^\/api\/media\/med_/);
    assert.match(r.json.person.avatar.url, /[?&]s=/);

    const seen = await api('/api/people/usr_ana', { as: 'ben' });
    assert.equal(seen.json.person.avatar.id, r.json.person.avatar.id,
      'a stranger sees the same photograph, not a private copy');

    const file = await api(seen.json.person.avatar.url);
    assert.equal(file.status, 200, file.text);
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
    assert.equal(file.headers['content-type'], 'image/png');
    assert.deepEqual(file.buf.subarray(0, 8), body.subarray(0, 8));
  });

  test('GET /api/me and GET /api/profile carry the same avatar', async () => {
    const me = await api('/api/me', { as: 'ana' });
    const profile = await api('/api/profile', { as: 'ana' });
    assert.ok(me.json.user.avatar?.url);
    assert.equal(me.json.user.avatar.id, profile.json.user.avatar.id);
  });

  test('the avatar row is not a slide on any work', async () => {
    const made = await api('/api/works', {
      method: 'POST', as: 'ana', body: { kind: 'photo', title: 'not a face' },
    });
    assert.equal(made.status, 200, made.text);
    const shot = png(1200, 800);
    assert.equal((await api(`/api/works/${made.json.work.id}/media`, {
      method: 'POST', as: 'ana', raw: shot, type: 'image/png',
    })).status, 200);

    const got = await api(`/api/works/${made.json.work.id}`, { as: 'ben' });
    assert.equal(got.json.work.media.length, 1, 'the face must not appear in the carousel');
    assert.ok(got.json.work.media[0].width === 1200);

    const avatars = rows('SELECT id FROM media WHERE user_id = ? AND work_id IS NULL', ID.ana);
    assert.equal(avatars.length, 1);
    const slides = rows('SELECT id FROM media WHERE work_id = ?', made.json.work.id);
    assert.equal(slides.length, 1);
    assert.notEqual(avatars[0].id, slides[0].id);
  });

  test('the bytes count against the same quota as everything else', async () => {
    const used = rows(
      'SELECT COALESCE(SUM(bytes),0) b FROM media WHERE user_id = ?', ID.ana,
    )[0].b;
    const avatar = rows(
      'SELECT bytes FROM media WHERE user_id = ? AND work_id IS NULL', ID.ana,
    )[0].bytes;
    assert.ok(used >= avatar, 'an avatar that did not count would be a second allowance');
  });
});

describe('the gate', () => {
  test('a PDF, a video and an SVG are 415', async () => {
    for (const [type, label] of [
      ['application/pdf', 'a document'],
      ['video/mp4', 'a clip'],
      ['image/svg+xml', 'script wearing an image extension'],
    ]) {
      const r = await api('/api/profile/avatar', {
        method: 'POST', as: 'ana', raw: Buffer.from('nope'), type,
      });
      assert.equal(r.status, 415, `${label} must not become a face (${type} → ${r.status})`);
    }
  });

  test('an agent token is refused — a face is a person presenting themselves', async () => {
    const r = await api('/api/profile/avatar', {
      method: 'POST', agent: 'ana', raw: png(8, 8), type: 'image/png',
    });
    assert.equal(r.status, 401);
  });

  test('no session is 401', async () => {
    const r = await api('/api/profile/avatar', {
      method: 'POST', raw: png(8, 8), type: 'image/png',
    });
    assert.equal(r.status, 401);
  });
});

describe('replace and remove', () => {
  test('a second upload deletes the previous file', async () => {
    const first = rows(
      'SELECT id, path FROM media WHERE user_id = ? AND work_id IS NULL', ID.ana,
    )[0];
    assert.ok(first, 'the earlier upload must still be there to replace');
    const abs = join(MEDIA, first.path);
    assert.equal(existsSync(abs), true, 'the first photograph is on disk before the replace');

    const r = await api('/api/profile/avatar', {
      method: 'POST', as: 'ana', raw: png(64, 80), type: 'image/png',
    });
    assert.equal(r.status, 200, r.text);
    assert.notEqual(r.json.person.avatar.id, first.id);

    assert.equal(existsSync(abs), false, 'the previous bytes must go — nothing cites them');
    const left = rows('SELECT id FROM media WHERE id = ?', first.id);
    assert.equal(left.length, 0);
  });

  test('remove returns avatar null and deletes the file', async () => {
    const current = rows(
      'SELECT id, path FROM media WHERE user_id = ? AND work_id IS NULL', ID.ana,
    )[0];
    const abs = join(MEDIA, current.path);
    const r = await api('/api/profile/avatar/remove', { method: 'POST', as: 'ana', body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.person.avatar, null);

    const seen = await api('/api/people/usr_ana', { as: 'ben' });
    assert.equal(seen.json.person.avatar, null);
    assert.equal(existsSync(abs), false);
    assert.equal(rows('SELECT id FROM media WHERE id = ?', current.id).length, 0);
  });

  test('removing when there is no photograph is still 200 with avatar null', async () => {
    const r = await api('/api/profile/avatar/remove', { method: 'POST', as: 'ben', body: {} });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.person.avatar, null);
  });
});

describe('existing databases still have the old NOT NULL', () => {
  test('a rebuild lets an avatar land without losing work media', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'avatar-old-'));
    const oldDb = join(dir, 'old.db');
    const oldMedia = join(dir, 'media');
    mkdirSync(join(oldMedia, 'aa'), { recursive: true });
    writeFileSync(join(oldMedia, 'aa', 'med_oldshot'), Buffer.from('old-bytes'));

    const db = new DatabaseSync(oldDb);
    const t = new Date().toISOString();
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE user (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'individual', jurisdiction TEXT NOT NULL DEFAULT 'IN',
        created_at TEXT NOT NULL
      );
      CREATE TABLE session (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), created_at TEXT NOT NULL
      );
      CREATE TABLE work (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id),
        kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
        shareable INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE media (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES work(id),
        user_id TEXT NOT NULL REFERENCES user(id),
        mime TEXT NOT NULL, kind TEXT NOT NULL, bytes INTEGER NOT NULL,
        path TEXT NOT NULL, filename TEXT NOT NULL DEFAULT '',
        ordinal INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO user (id,email,name,created_at) VALUES (?,?,?,?)')
      .run('usr_old', 'old@example.test', 'Old', t);
    db.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)')
      .run('tok_old', 'usr_old', t);
    db.prepare('INSERT INTO work (id,user_id,kind,title,body,shareable,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('wrk_old', 'usr_old', 'photo', 'kept', '', 1, t);
    db.prepare(`INSERT INTO media (id,work_id,user_id,mime,kind,bytes,path,filename,ordinal,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run('med_oldshot', 'wrk_old', 'usr_old', 'image/png', 'image', 9, join('aa', 'med_oldshot'), 'shot.png', 0, t);
    db.close();

    const port = await freePort();
    const proc = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), DB_PATH: oldDb, MEDIA_PATH: oldMedia,
             INVITE_CODE: 'avatar-old', OAUTH_STATE_SECRET: 'avatar-old-secret' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    const call = (path, opts = {}) => new Promise((resolve, reject) => {
      const payload = opts.raw ?? (opts.body === undefined ? null : JSON.stringify(opts.body));
      const req = request({
        host: '127.0.0.1', port, path, method: opts.method || 'GET', agent: false,
        headers: {
          Authorization: 'Bearer tok_old',
          ...(payload ? {
            'content-type': opts.type || (opts.raw ? 'application/octet-stream' : 'application/json'),
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

    try {
      const deadline = Date.now() + 60_000;
      for (;;) {
        if (Date.now() > deadline) throw new Error(`old-shape server did not start: ${stderr}`);
        try { if ((await call('/api/health')).status === 200) break; } catch { /* not up */ }
        await sleep(100);
      }

      const check = new DatabaseSync(oldDb);
      const info = check.prepare('PRAGMA table_info(media)').all();
      const workCol = info.find((c) => c.name === 'work_id');
      assert.equal(workCol.notnull, 0, 'the rebuild must have run');
      const kept = check.prepare('SELECT id, work_id FROM media WHERE id = ?').get('med_oldshot');
      check.close();
      assert.equal(kept?.work_id, 'wrk_old', 'existing slides must survive the rebuild');

      const up = await call('/api/profile/avatar', {
        method: 'POST', raw: png(32, 32), type: 'image/png',
      });
      assert.equal(up.status, 200, up.text);
      assert.ok(up.json.person.avatar?.id);
    } finally {
      proc.kill();
    }
  });
});

describe('the glass', () => {
  test('Avatar.jsx renders an img only when src is present, and initials otherwise', () => {
    assert.match(AVATAR, /if \(src\)/);
    assert.match(AVATAR, /<img/);
    assert.match(AVATAR, /initialsOf/);
    assert.doesNotMatch(AVATAR, /cropStyle/,
      'zoom belongs to a post; an avatar is a circle, centre-cropped');
  });

  test('You and Person take the URL from avatar.url, never a constructed path', () => {
    assert.match(YOU, /p\.user\.avatar\?\.url/);
    assert.match(PERSON, /person\.avatar\?\.url/);
    assert.doesNotMatch(YOU, /cropStyle/);
    assert.doesNotMatch(PERSON, /cropStyle/);
  });

  test('the edit screen is where the file is chosen, and Remove is gated on a photo existing', () => {
    assert.match(SETTINGS, /uploadAvatar/);
    assert.match(SETTINGS, /removeAvatar/);
    assert.match(SETTINGS, /avatar \? 'Change photo' : 'Add a photo'/);
    assert.match(SETTINGS, /\{avatar && \(/);
  });

  test('OAuth never stores a provider picture URL', () => {
    assert.doesNotMatch(OAUTH, /picture/,
      'a Google photo URL in an img is an external host; fetch it server-side if you ever want it');
    assert.doesNotMatch(OAUTH, /avatar_url/);
  });

  test('the upload route is registered', () => {
    assert.match(SERVER, /route\('POST', '\/api\/profile\/avatar'/);
    assert.match(SERVER, /route\('POST', '\/api\/profile\/avatar\/remove'/);
    assert.match(SERVER, /spec\.kind !== 'image'/);
  });
});
