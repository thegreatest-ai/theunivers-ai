/**
 * "Use my location" — the device asks, the server names it, only the name is kept.
 *
 * The load-bearing tests here are the ones that would be quietly lost first:
 * coordinates never become a column, the raw geocoder payload never reaches the
 * client, a provider failure is not the author's error, and the permission
 * prompt fires only on a click. The typed path is the other half and is not
 * replaced — it must still work with the geocoder unreachable.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP } from '../shared/csp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAT = {
  place_id: 999,
  licence: 'Data © OpenStreetMap contributors',
  osm_type: 'way',
  osm_id: 424242,
  lat: '25.0762',
  lon: '55.1341',
  display_name: 'Marina Walk, Dubai Marina, Dubai, United Arab Emirates',
  name: 'Dubai Marina',
  address: {
    house_number: '12',
    road: 'Marina Walk',
    suburb: 'Dubai Marina',
    city: 'Dubai',
    country: 'United Arab Emirates',
    country_code: 'ae',
    postcode: '00000',
  },
};

describe('the mapping: a short name, never a door, never a raw payload', () => {
  let nameFrom;

  before(async () => {
    process.env.GEOCODE_MIN_INTERVAL_MS = '0';
    process.env.GEOCODE_URL = 'http://127.0.0.1:1/reverse';
    ({ nameFrom } = await import('../server/geocode.mjs'));
  });

  test('suburb plus country_code becomes place / place_cc, uppercased', () => {
    assert.deepEqual(nameFrom(FAT), { place: 'Dubai Marina', place_cc: 'AE' });
  });

  test('a street address with no area name is refused — that is the front door', () => {
    assert.deepEqual(nameFrom({
      display_name: '12 Marina Walk, Dubai, United Arab Emirates',
      address: { house_number: '12', road: 'Marina Walk', postcode: '00000', country_code: 'ae' },
    }), { place: null });
  });

  test('an over-long suburb is skipped, not truncated, and the city is used instead', () => {
    assert.deepEqual(nameFrom({
      address: { suburb: 'x'.repeat(81), city: 'Dubai', country_code: 'ae' },
    }), { place: 'Dubai', place_cc: 'AE' });
  });

  test('an unknown country code drops the code, not the name', () => {
    assert.deepEqual(nameFrom({
      address: { city: 'Somewhere', country_code: 'xx' },
    }), { place: 'Somewhere', place_cc: null });
  });

  test('a provider error or empty payload is no place, not a throw', () => {
    assert.deepEqual(nameFrom(null), { place: null });
    assert.deepEqual(nameFrom({ error: 'Unable to geocode' }), { place: null });
    assert.deepEqual(nameFrom({}), { place: null });
  });

  test('display_name is never the name we return', () => {
    const named = nameFrom(FAT);
    assert.notEqual(named.place, FAT.display_name);
    assert.doesNotMatch(named.place, /Marina Walk/);
  });
});

describe('the surfaces: click only, labelled, privacy copy, caption unchanged', () => {
  test('PlaceFields asks the device only from Use my location, never on mount', () => {
    const raw = read('src/app/PlaceFields.jsx');
    const code = strip(raw);
    assert.match(code, /Use my location/, 'the primary control is the words, not a glyph');
    assert.match(code, /onClick=\{useMyLocation\}/);
    assert.match(code, /navigator\.geolocation\.getCurrentPosition/);
    assert.match(code, /enableHighAccuracy:\s*false/,
      'a suburb name needs no GPS fix, and high accuracy is precision we throw away');
    assert.doesNotMatch(code, /useEffect/,
      'a mount effect that asked for permission would be the prompt nobody clicked');
    assert.match(raw, /Looking up/, 'GPS can take several seconds; the button must say so');
    /*
     * WITH NOTHING TO TYPE, EVERY FAILURE IS TERMINAL. These messages used to end "You can type
     * it instead", which was true while a text field sat beside the button. The owner removed
     * it, so that sentence became an instruction to use a control that is not there — worse than
     * no advice at all. The messages now state what happened and stop.
     */
    assert.match(raw, /Location is off for this site\./);
    assert.match(raw, /Location timed out\./);
    assert.match(raw, /Location is unavailable\./);
    assert.match(raw, /Could not find a place name for where you are/);
    // `code`, not `raw`: the file's own comment explains WHY that sentence was removed, and a
    // test that cannot tell a comment from a string would forbid explaining its own rule.
    assert.doesNotMatch(strip(raw), /type it instead/,
      'there is no field to type in — this copy must not come back with the field still gone');
  });

  test('CreatePost and WorkDetail do not call geolocation themselves — PlaceFields does', () => {
    assert.doesNotMatch(strip(read('src/app/CreatePost.jsx')), /navigator\.geolocation/);
    assert.doesNotMatch(strip(read('src/app/WorkDetail.jsx')), /navigator\.geolocation/);
    assert.match(read('src/app/WorkDetail.jsx'), /<PlaceFields/,
      'changing a location later is the same gesture as setting it');
  });

  test('the row is labelled Location, with Use my location first, and a removable chip', () => {
    const fields = read('src/app/PlaceFields.jsx');
    const code = strip(fields);
    assert.match(code, /<legend[^>]*>[\s\S]*Location/, 'a glyph alone is not a label');
    assert.match(code, /cp-place-use/);
    assert.match(code, /cp-place-chip/);
    assert.match(code, /Remove location/);
    /*
     * THE RULE MOVED TWICE, so it is worth stating plainly rather than leaving the assertion to
     * imply it. It began as a typed field plus a country select. Both were removed for one
     * button. Then the button alone proved too little: a geocoder returns the wrong suburb often
     * enough, and a place nobody can correct is one they publish wrongly or abandon.
     *
     * Where it landed: the BUTTON LEADS and an EDITABLE FIELD CORRECTS. The country select stays
     * gone — the geocoder supplies place_cc, and a dropdown beside a resolved name is a second
     * way to say the same thing, which is a second way to disagree with it.
     */
    const useAt = code.indexOf('Use my location');
    const fieldAt = code.indexOf('cp-place-input');
    assert.ok(useAt >= 0, 'the button is the primary control');
    assert.ok(fieldAt > useAt, 'the field corrects what the button resolved, so it comes after');
    assert.doesNotMatch(code, /COUNTRY_OPTIONS|from '\.\/countries'/,
      'the country select stays removed; the geocoder still supplies place_cc');
  });

  test('the privacy copy is present, and it stays true only while there is no lat/lng column', () => {
    assert.match(read('src/app/PlaceFields.jsx'),
      /Your coordinates are used to look up a place name and are not saved\./);
    const db = read('server/db.mjs');
    assert.doesNotMatch(db, /ensureColumn\('work',\s*'(lat|lng|latitude|longitude|coords|coordinates)'/);
    assert.match(db, /ensureColumn\('work', 'place'/);
    assert.match(db, /ensureColumn\('work', 'place_cc'/);
  });

  test('the page still only talks to its own origin', () => {
    assert.doesNotMatch(CSP, /nominatim|openstreetmap|mapbox|maps\.google|places\.googleapis/i);
    assert.match(read('src/app/api.js'), /\/api\/geocode\/reverse/,
      'the browser sends coordinates to us');
    assert.doesNotMatch(strip(read('src/app/PlaceFields.jsx')), /nominatim|openstreetmap/i,
      'PlaceFields must not name a geocoder host');
    assert.match(read('server/index.mjs'), /geolocation=\(self\)/,
      'Permissions-Policy must allow the click; geolocation=() would make the button a lie');
  });

  test('the resolved name still goes through parsePlace — a geocoder cannot bypass the gate', () => {
    const geo = read('server/geocode.mjs');
    assert.match(geo, /parsePlace/, 'the name is validated against the same rules as the typed field');
    assert.match(geo, /parsePlaceCc/);
    assert.match(read('server/index.mjs'), /from '\.\/geocode\.mjs'/);
  });
});

describe('POST /api/geocode/reverse — and the typed path beside it', () => {
  const TOK = { ana: 'tok_ll_ana' };
  let PORT; let child; let DB;
  let mock; let mockPort;
  const nominatim = { status: 200, body: FAT, hits: 0, lastUa: '' };

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
          ...(payload ? {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
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
  }

  const rows = (sql, ...params) => {
    const db = new DatabaseSync(DB);
    try { return db.prepare(sql).all(...params); } finally { db.close(); }
  };

  before(async () => {
    mock = createServer((req, res) => {
      nominatim.hits += 1;
      nominatim.lastUa = String(req.headers['user-agent'] ?? '');
      if (nominatim.status !== 200) {
        res.writeHead(nominatim.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'upstream' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(nominatim.body));
    });
    await new Promise((resolve, reject) => {
      mock.listen(0, '127.0.0.1', (e) => (e ? reject(e) : resolve()));
    });
    mockPort = mock.address().port;

    PORT = await freePort();
    const dir = mkdtempSync(join(tmpdir(), 'live-location-'));
    DB = join(dir, 'live-location.db');
    child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        DB_PATH: DB,
        MEDIA_PATH: join(dir, 'media'),
        INVITE_CODE: 'live-location-test',
        OAUTH_STATE_SECRET: 'live-location-secret',
        GEOCODE_URL: `http://127.0.0.1:${mockPort}/reverse`,
        GEOCODE_MIN_INTERVAL_MS: '0',
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
      .run(TOK.ana, 'usr_ana', t);
    db.close();
  });

  after(() => {
    child?.kill();
    mock?.close();
  });

  test('session required', async () => {
    const r = await api('/api/geocode/reverse', {
      method: 'POST', body: { lat: 25.0762, lng: 55.1341 },
    });
    assert.equal(r.status, 401);
  });

  test('out-of-range or non-numeric coordinates are a 400', async () => {
    const bad = [
      { lat: 91, lng: 0 },
      { lat: -91, lng: 0 },
      { lat: 0, lng: 181 },
      { lat: 0, lng: -181 },
      { lat: '25.07', lng: 55.13 },
      { lat: null, lng: 0 },
      { lat: [25], lng: 55 },
      { lng: 55.13 },
      {},
    ];
    for (const body of bad) {
      const r = await api('/api/geocode/reverse', { method: 'POST', as: 'ana', body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
  });

  test('the route returns only place / place_cc — the raw provider payload does not leak', async () => {
    nominatim.status = 200;
    nominatim.body = FAT;
    const before = nominatim.hits;
    const r = await api('/api/geocode/reverse', {
      method: 'POST', as: 'ana', body: { lat: 25.0762, lng: 55.1341 },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.place, 'Dubai Marina');
    assert.equal(r.json.place_cc, 'AE');
    assert.deepEqual(Object.keys(r.json).sort(), ['place', 'place_cc']);
    assert.equal(r.json.display_name, undefined);
    assert.equal(r.json.licence, undefined);
    assert.equal(r.json.osm_id, undefined);
    assert.equal(r.json.address, undefined);
    assert.equal(r.json.lat, undefined);
    assert.equal(r.json.lon, undefined);
    assert.doesNotMatch(r.text, /Marina Walk/);
    assert.doesNotMatch(r.text, /OpenStreetMap/);
    assert.ok(nominatim.hits > before, 'the provider must have been asked');
    assert.match(nominatim.lastUa, /theunivers\.ai/,
      'Nominatim blocks unmetered use; the User-Agent must name this app');
  });

  test('a second nearby request is served from the cache, without a second provider call', async () => {
    nominatim.status = 200;
    nominatim.body = FAT;
    const before = nominatim.hits;
    // 3-decimal rounding: 1.2342 and 1.2344 share the ~110m key. A different
    // cell than the leak test above, so this is a real first miss then a hit.
    const first = await api('/api/geocode/reverse', {
      method: 'POST', as: 'ana', body: { lat: 1.2342, lng: 2.3452 },
    });
    assert.equal(first.status, 200, first.text);
    const afterFirst = nominatim.hits;
    assert.equal(afterFirst, before + 1);

    const second = await api('/api/geocode/reverse', {
      method: 'POST', as: 'ana', body: { lat: 1.2344, lng: 2.3451 },
    });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.place, first.json.place);
    assert.equal(nominatim.hits, afterFirst, 'standing still must not re-ask the geocoder');
  });

  test('a provider failure returns 200 with place: null, not a 5xx', async () => {
    nominatim.status = 503;
    const r = await api('/api/geocode/reverse', {
      method: 'POST', as: 'ana', body: { lat: 51.5074, lng: -0.1278 },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.place, null);
    assert.equal(r.json.display_name, undefined);
    nominatim.status = 200;
  });

  test('no lat/lng column exists on work — the privacy copy depends on it', async () => {
    const cols = rows('PRAGMA table_info(work)').map((c) => c.name);
    for (const name of ['lat', 'lng', 'latitude', 'longitude', 'coords', 'coordinates']) {
      assert.equal(cols.includes(name), false, `work.${name} must not exist`);
    }
    assert.ok(cols.includes('place'));
    assert.ok(cols.includes('place_cc'));
  });

  test('the typed path still works with the geocoder unreachable', async () => {
    nominatim.status = 500;
    const hits = nominatim.hits;
    const r = await api('/api/works', {
      method: 'POST', as: 'ana',
      body: { kind: 'photo', title: 'typed-while-down', place: 'Al Quoz', place_cc: 'AE' },
    });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.work.place, 'Al Quoz');
    assert.equal(r.json.work.place_cc, 'AE');
    assert.equal(nominatim.hits, hits, 'creating a work must not call the geocoder');
    const [row] = rows('SELECT place, place_cc FROM work WHERE id = ?', r.json.work.id);
    assert.equal(row.place, 'Al Quoz');
    assert.equal(row.place_cc, 'AE');
    nominatim.status = 200;
  });
});
