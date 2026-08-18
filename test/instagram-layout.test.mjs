/**
 * Instagram layout and interaction — the model, not the dress.
 *
 * Functionality is free: a 3-column flush grid, a two-pane detail, swipe on a
 * carousel, Create in the chrome rather than a floating button. Trade dress is
 * not: no gradient as identity, no camera glyph, no "insta". See
 * docs/specs/INSTAGRAM-LAYOUT.md and INSTAGRAM-SPEC-FINDINGS.md part 8.
 *
 * Source-reading, because this is layout. An HTTP test cannot see a grid column
 * count.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the profile grid is three flush 3:4 columns', () => {
  test('always three columns, 1px gutters, no per-post shape', () => {
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-grid\{[^}]*grid-template-columns:repeat\(3,1fr\)/s);
    assert.match(css, /\.wk-grid\{[^}]*gap:1px/s);
    assert.match(css, /\.wk-shot\{[^}]*aspect-ratio:3\/4/s);
    const works = read('src/app/Works.jsx');
    assert.doesNotMatch(works, /cellAspect/);
    assert.doesNotMatch(works, /feedAspect/);
  });

  test('the tile itself is the photograph — the foot lives in the detail', () => {
    const src = read('src/app/Works.jsx');
    assert.match(src, /kind !== 'photo' && kind !== 'video'/);
  });
});

describe('Create is chrome, not a floating third place', () => {
  test('the FAB is gone; Create is in the rail and the phone top bar', () => {
    const nav = read('src/app/Nav.jsx');
    const shell = read('src/app/Shell.jsx');
    const css = read('src/app/app.css');
    assert.doesNotMatch(nav, /nav-fab/);
    assert.doesNotMatch(css, /\.nav-fab\{/);
    assert.match(nav, /className="nav-create"/);
    assert.match(shell, /className="app-bar-create"/);
    assert.match(shell, /<CreatePost/);
    assert.match(shell, /kind="photo"/);
  });

  test('Account and Sign out leave the phone top bar', () => {
    const shell = read('src/app/Shell.jsx');
    const css = read('src/app/app.css');
    assert.match(shell, /app-bar-desk/);
    assert.match(css, /\.app-bar-desk\{display:none\}/);
    assert.match(read('src/app/Settings.jsx'), /Sign out/);
  });
});

describe('the detail is a window: media, swipe, labelled previous/next', () => {
  test('WorkDetail keeps Previous/Next and adds a swipe target', () => {
    const src = read('src/app/WorkDetail.jsx');
    assert.match(src, />Previous</);
    assert.match(src, />Next</);
    assert.match(src, /bindSwipeX/);
    assert.match(src, /from '\.\/swipe'/);
    assert.match(src, /className="wk-detail wk-post"/);
    assert.doesNotMatch(src, /feedAspect/, 'detail is the bytes, not the feed crop');
    assert.doesNotMatch(src, /cellAspect/);
  });

  test('compose does not inherit the two-pane post layout', () => {
    const create = read('src/app/CreatePost.jsx');
    assert.doesNotMatch(create, /wk-post/);
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-detail\.cp\{[^}]*overflow:hidden/s);
  });
});

describe('Discover works is a feed, not the profile cell', () => {
  test('the Works tab is dsc-feed, and it still does not wear .wk-shot', () => {
    const src = read('src/app/Discover.jsx');
    assert.match(src, /dsc-feed/);
    assert.match(src, /ig-post/);
    assert.doesNotMatch(src, /wk-shot/);
    assert.match(src, /feedAspect/);
    assert.match(src, /WorkDetail/);
  });
});

describe('published is derived, and the public profile shows it', () => {
  test('publicPerson counts published from work rows', () => {
    const src = read('server/index.mjs');
    assert.match(src, /function publishedCount/);
    assert.match(src, /published: publishedCount\(u\.id, viewerId\)/);
    assert.doesNotMatch(src, /UPDATE user SET.*published/, 'must not be a stored counter');
  });

  test('the public profile paints the three Instagram-index counts', () => {
    const src = read('src/app/Person.jsx');
    assert.match(src, /counts\.published/);
    assert.match(src, /counts\.followers/);
    assert.match(src, /counts\.following/);
    assert.match(src, /ig-head/);
  });
});

describe('no likes, no Instagram dress', () => {
  test('the new chrome does not grow a heart, a like, or a branded filter name', () => {
    const files = [
      'src/app/WorkDetail.jsx', 'src/app/Discover.jsx', 'src/app/Person.jsx',
      'src/app/Shell.jsx', 'src/app/swipe.js',
    ];
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /onDoubleClick|double-tap|doubleTap/);
      assert.doesNotMatch(src, /aria-label="Like"|className="[^"]*like/);
      assert.doesNotMatch(src, /Clarendon|Juno|X-Pro/);
    }
  });
});
