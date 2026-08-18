/**
 * A location on a post is the author's claim, and nothing more.
 *
 * The load-bearing tests here are the absences: no geocoding host in the CSP,
 * and no path from this field into trust, ranking or assurance. An unverified
 * string that moved a tier would be standing bought with a sentence, and that
 * is the invariant that would be quietly lost first.
 *
 * Sensing — the button that asks the device, the server-side proxy that names
 * it — lives in live-location.test.mjs. This file is the caption: how it is
 * parsed, how it is worded, and what it must never become.
 *
 * The HTTP round-trip, the 400s, and author-only / 409 live in work-actions.test.mjs
 * next to the other work-mutation rules they have to keep obeying.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlace, parsePlaceCc, placeClaim, PLACE_MAX, COUNTRY_CODES } from '../shared/place.mjs';
import { CSP } from '../shared/csp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('parse: omitted, empty, too long, unknown', () => {
  test('omitted is missing, so CREATE can default and UPDATE can leave it', () => {
    assert.deepEqual(parsePlace(undefined), { missing: true });
    assert.deepEqual(parsePlaceCc(undefined), { missing: true });
  });

  test('empty after trim is NULL — that is how a location is removed', () => {
    assert.deepEqual(parsePlace(null), { value: null });
    assert.deepEqual(parsePlace(''), { value: null });
    assert.deepEqual(parsePlace('   '), { value: null });
    assert.deepEqual(parsePlaceCc(null), { value: null });
    assert.deepEqual(parsePlaceCc(''), { value: null });
  });

  test('a place over 80 characters is an error, never a silent truncate', () => {
    assert.equal(parsePlace('x'.repeat(PLACE_MAX)).value.length, PLACE_MAX);
    assert.equal(parsePlace('x'.repeat(PLACE_MAX + 1)).error, 'place is too long');
  });

  test('an unknown place_cc is an error, including the separator row', () => {
    assert.deepEqual(parsePlaceCc('AE'), { value: 'AE' });
    assert.deepEqual(parsePlaceCc('IN'), { value: 'IN' });
    assert.equal(parsePlaceCc('XX').error, 'unknown country');
    assert.equal(parsePlaceCc('ae').error, 'unknown country',
      'do not coerce case — unknown is a 400, never a silent default');
    assert.equal(parsePlaceCc('—').error, 'unknown country',
      'the countries.js separator is not a country');
    assert.equal(COUNTRY_CODES.has('—'), false);
  });

  test('a country with no place name is a location, and so is a place name with no country', () => {
    assert.deepEqual(parsePlace('Jebel Ali'), { value: 'Jebel Ali' });
    assert.deepEqual(parsePlaceCc('AE'), { value: 'AE' });
    // Either half alone is accepted; the combination is the caller's.
    assert.equal(parsePlace('Jebel Ali').error, undefined);
    assert.equal(parsePlaceCc('').value, null);
  });
});

describe('the line a reader sees is a claim, and absent is absent', () => {
  test('both halves format as "name, CC · added by the author"', () => {
    assert.equal(placeClaim('Jebel Ali', 'AE'), 'Jebel Ali, AE · added by the author');
  });

  test('either half alone is still worded as the author\'s', () => {
    assert.equal(placeClaim('Jebel Ali', null), 'Jebel Ali · added by the author');
    assert.equal(placeClaim(null, 'AE'), 'AE · added by the author');
  });

  test('NULL, empty, and whitespace render as nothing at all', () => {
    assert.equal(placeClaim(null, null), null);
    assert.equal(placeClaim('', ''), null);
    assert.equal(placeClaim('  ', '  '), null);
    assert.equal(placeClaim(undefined, undefined), null);
  });

  test('user text stays text — angle brackets are not interpreted here', () => {
    // Rendering is `{line}` as a text child, never markup, never a URL. Pinning the
    // string itself means a later interpolation into href or innerHTML has to change
    // this helper, which this file will see.
    assert.equal(placeClaim('<b>x</b>', 'AE'), '<b>x</b>, AE · added by the author');
  });
});

describe('a caption, not a geocoding client — and not evidence', () => {
  test('Inspect still reads a device position — that is the other system', () => {
    assert.match(strip(read('src/app/Inspect.jsx')), /navigator\.geolocation/,
      'the inspection path must keep reading a device position — this field is the other thing');
  });

  test('Discover never calls navigator.geolocation', () => {
    assert.doesNotMatch(strip(read('src/app/Discover.jsx')), /navigator\.geolocation/,
      'a Discover cell rendering a caption must not sense a position');
  });

  test('the CSP was not opened for a places API', () => {
    assert.doesNotMatch(CSP, /maps\.google|nominatim|mapbox|openstreetmap|geocode|places\.googleapis/i,
      'the geocoder is reached from the server; opening connect-src would be the hole this design exists to avoid');
    assert.match(CSP, /connect-src 'self' https:\/\/cdn\.jsdelivr\.net/,
      'connect-src stays the list it was; this feature adds no host');
  });

  test('CreatePost does not remember a location from the last post or the profile country', () => {
    const src = strip(read('src/app/CreatePost.jsx'));
    assert.doesNotMatch(src, /localStorage/, 'a remembered location is how someone publishes a place they did not mean to');
    assert.doesNotMatch(src, /jurisdiction/, 'do not pre-fill from the author\'s profile country');
    assert.doesNotMatch(src, /useOutletContext/, 'the create window must not even see the profile to copy from');
    assert.match(src, /useState\(''\)/, 'both halves default empty on every new post');
  });
});

describe('it reaches no trust, ranking or assurance code path', () => {
  /*
   * Assert the ABSENCE, because this is the invariant that would be quietly lost first.
   * `place` as an English word is everywhere ("one place", "in place"); the field names
   * and the parser are not. Those are what must not appear on a path that grades standing.
   */
  const FORBIDDEN = /\bplace_cc\b|\bparsePlace\b|\bparsePlaceCc\b|\bplaceClaim\b|\bw\.place\b|\br\.place\b/;

  test('trust, ranking and assurance never read a post location', () => {
    for (const f of [
      'shared/ranking.mjs',
      'shared/assurance.mjs',
      'server/trust.mjs',
      'server/vendor/trust-rules.ts',
      'server/inspection.mjs',
    ]) {
      assert.doesNotMatch(read(f), FORBIDDEN,
        `${f} must not take a typed place as an input — that would be standing bought with a sentence`);
    }
  });

  test('Discover returns the fields and does not score them', () => {
    const server = read('server/index.mjs');
    const work = server.slice(server.indexOf("kind === 'work'"), server.indexOf("kind === 'agent'"));
    assert.match(work, /place: w\.place \?\? null/,
      'the payload must carry the claim so the cell can render it');
    assert.match(work, /place_cc: w\.place_cc \?\? null/);
    assert.doesNotMatch(work, /standingScore/,
      'the work branch must not score inside the map; standingScore is applied later and must stay two-term');

    const scoreAt = server.indexOf('const standingScore');
    const score = server.slice(scoreAt, server.indexOf('\nroute(', scoreAt));
    assert.doesNotMatch(score, FORBIDDEN,
      'standingScore is tier plus citations; a place must not become a third term');
    assert.match(score, /tierRank\(r\.tier\)/, 'the two terms that do apply are still the two terms');
    assert.match(score, /citedWeight \?\? r\.cited/,
      'citations still weigh the score; location must not join them');
  });

  test('the shared ranker still has four terms, and none of them is a place', () => {
    const src = read('shared/ranking.mjs');
    assert.doesNotMatch(src, FORBIDDEN);
    assert.match(src, /part: 'cited'/);
    assert.match(src, /part: 'standing'/);
    assert.match(src, /part: 'watched'/);
    assert.match(src, /part: 'age'/);
  });
});

describe('the surfaces: a caption, not a badge, and NULL paints nothing', () => {
  test('WorkDetail and Discover render through PlaceLine, which returns null when absent', () => {
    const fields = read('src/app/PlaceFields.jsx');
    const code = strip(fields);
    assert.match(code, /if \(!line\) return null/,
      'absent must render as absent: no empty row, no placeholder');
    assert.doesNotMatch(code, /Location:/, 'no "Location: —" in the executable component');
    assert.match(code, /\{line\}/, 'text child, never markup');
    assert.doesNotMatch(code, /dangerouslySetInnerHTML/);
    assert.doesNotMatch(code, /href=\{/, 'never interpolated into a URL');

    assert.match(read('src/app/WorkDetail.jsx'), /<PlaceLine /,
      'the detail view shows the claim when present');
    assert.match(read('src/app/Discover.jsx'), /<PlaceLine /,
      'the Discover cell shows the claim when present');
  });

  test('the wording is the author\'s claim, not an attested position', () => {
    const fields = read('src/app/PlaceFields.jsx');
    const lineFn = fields.slice(fields.indexOf('export function PlaceLine'));
    assert.match(read('shared/place.mjs'), /added by the author/);
    assert.match(fields, /placeClaim/, 'the surfaces share the helper so the wording cannot drift');
    assert.doesNotMatch(strip(fields), /attested/,
      'that word belongs to the inspection grade, not to a typed caption');
    assert.doesNotMatch(lineFn, /<svg/,
      'PlaceLine must not borrow a pin from the compose row — a caption that looks attested is the failure');
    // The typed field and the country select were removed by the owner: adding a location is a
    // button press, not a form. So this asserts the CONTROL exists, not a placeholder that no
    // longer does — pinning removed copy is how a test outlives the thing it was testing.
    assert.match(read('src/app/PlaceFields.jsx'), /Use my location/);
    assert.match(read('src/app/CreatePost.jsx'), /<PlaceFields/,
      'the control sits in CreatePost');
  });

  test('the profile grid keeps one shape and still ignores work.ratio', () => {
    // Do not reintroduce cdda5cb. A location on a post is not a reason to reshape the grid.
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-shot\{[^}]*aspect-ratio:3\/4/s);
    const works = read('src/app/Works.jsx');
    assert.doesNotMatch(works, /cellAspect/, 'the grid must not consult a per-post ratio');
    assert.doesNotMatch(works, /aspectRatio/, 'no inline per-cell shape');
    assert.doesNotMatch(works, /feedAspect/, 'the grid must not start reading the feed helper');
  });
});
