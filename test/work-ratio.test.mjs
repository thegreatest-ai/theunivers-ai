/**
 * Presentation ratio: one per post, never a crop of the bytes.
 *
 * These are the rules the grid actually uses. An HTTP test can prove the column round-trips;
 * it cannot prove the cell reads the post's ratio rather than each slide's. That lives here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkRatio, ratioAspect, cellAspect, feedAspect, WORK_RATIOS } from '../shared/work-ratio.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the four allowed values, and nothing else', () => {
  test('Original · 1:1 · 4:5 · 16:9 are the options', () => {
    assert.deepEqual(WORK_RATIOS.map((r) => r.id), ['original', '1:1', '4:5', '16:9']);
  });

  test('omitted is missing, so CREATE can default and UPDATE can leave it', () => {
    assert.deepEqual(parseWorkRatio(undefined), { missing: true });
  });

  test('Original stores as NULL', () => {
    assert.deepEqual(parseWorkRatio('original'), { value: null });
    assert.deepEqual(parseWorkRatio(null), { value: null });
  });

  test('the three crops store as themselves', () => {
    assert.deepEqual(parseWorkRatio('1:1'), { value: '1:1' });
    assert.deepEqual(parseWorkRatio('4:5'), { value: '4:5' });
    assert.deepEqual(parseWorkRatio('16:9'), { value: '16:9' });
  });

  test('an unknown value is an error, never a silent default', () => {
    assert.equal(parseWorkRatio('2:3').error, 'unknown ratio');
    assert.equal(parseWorkRatio('1:1 ').error, 'unknown ratio');
    assert.equal(parseWorkRatio('').error, 'unknown ratio');
    assert.equal(parseWorkRatio(1).error, 'unknown ratio');
  });
});

describe('the profile grid is square, whatever the post says', () => {
  /*
   * These tests replace ones that asserted the opposite, and the reason is worth keeping.
   *
   * The first version let the grid cell follow work.ratio, falling back to the photograph's own
   * shape when the ratio was NULL. Since EVERY work that already exists is NULL, that put the
   * ragged grid straight back — the exact thing the owner asked to have fixed. The brief said
   * "absent must render as the true shape" and the brief was wrong.
   *
   * The instruction is "the photo display in profile will be unified in profile". A grid that
   * reserves each cell differently is not unified, and it makes no difference whether the
   * difference came from the file or from a chosen ratio.
   */
  test('a chosen ratio does NOT reshape the profile cell', () => {
    assert.equal(cellAspect({ ratio: '4:5', media: [{ ratio: 1.5 }] }), 1);
    assert.equal(cellAspect({ ratio: '16:9', media: [{ ratio: 0.5 }] }), 1);
  });

  test('a pre-existing work (ratio NULL) is square too — this is the regression', () => {
    assert.equal(cellAspect({ ratio: null, media: [{ ratio: 1.3333 }] }), 1);
  });

  test('every cell in a mixed grid reserves the same box', () => {
    const grid = [
      { ratio: '4:5', media: [{ ratio: 1.5 }] },
      { ratio: null, media: [{ ratio: 0.66 }] },
      { ratio: '16:9', media: [] },
      { ratio: 'original', media: [{ ratio: null }] },
    ].map(cellAspect);
    assert.deepEqual(grid, [1, 1, 1, 1], 'one shape for the whole grid, no exceptions');
  });

  test('missing dimensions cannot produce a zero-height box', () => {
    // The old failure mode: undefined aspect → no reserved space → a collapsed cell.
    for (const w of [{ ratio: null, media: [] }, { ratio: null }, {}, undefined]) {
      assert.equal(cellAspect(w), 1);
    }
  });

  test('the ratio a post carries is still available for the FEED', () => {
    // The grid deliberately ignores this; the feed deliberately does not. ratioAspect is the
    // mapping; feedAspect is the cell that uses it.
    assert.equal(ratioAspect('4:5'), 4 / 5);
    assert.equal(ratioAspect('16:9'), 16 / 9);
  });

  test('Original has no aspect of its own', () => {
    assert.equal(ratioAspect('original'), null);
    assert.equal(ratioAspect(null), null);
  });
});

describe('the feed cell follows the author\'s chosen ratio', () => {
  test('a 4:5 post reserves 4/5; 16:9 reserves 16/9', () => {
    // Chosen wins even when the file itself disagrees — that is the composition, shown.
    assert.equal(feedAspect({ ratio: '4:5', media: [{ ratio: 1.5 }] }), 4 / 5);
    assert.equal(feedAspect({ ratio: '16:9', media: [{ ratio: 0.5 }] }), 16 / 9);
    assert.equal(feedAspect({ ratio: '1:1', media: [{ ratio: 1.3333 }] }), 1);
  });

  test('an Original post falls back to the photograph\'s own ratio', () => {
    assert.equal(feedAspect({ ratio: null, media: [{ ratio: 1.3333 }] }), 1.3333);
    assert.equal(feedAspect({ ratio: 'original', media: [{ ratio: 0.66 }] }), 0.66);
  });

  test('a post with no dimensions at all renders without a zero-height cell', () => {
    for (const w of [
      { ratio: null, media: [] },
      { ratio: null, media: [{ ratio: null }] },
      { ratio: 'original', media: [{ ratio: 0 }] },
      { ratio: null },
      {},
      undefined,
    ]) {
      const a = feedAspect(w);
      assert.equal(a, null, `must reserve nothing, not ${a}`);
    }
  });

  test('Discover shows the first media and opens the existing detail view', () => {
    const src = read('src/app/Discover.jsx');
    assert.match(src, /feedAspect/, 'the cell must read the shared mapping, not a local copy');
    assert.match(src, /from '\.\.\/\.\.\/shared\/work-ratio\.mjs'/);
    assert.match(src, /<img /, 'a photograph found by search is no longer a line of text');
    assert.match(src, /WorkDetail/, 'clicking opens the view that already exists');
    assert.doesNotMatch(src, /WORK_RATIOS/, 'a reader does not edit the author\'s ratio');
  });

  test('the feed cell is not the profile cell — .wk-shot stays square', () => {
    // Sharing .wk-shot would square every Discover cell, which is the regression the other
    // way: the author's composition would vanish into the index shape.
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-shot\{[^}]*aspect-ratio:1/s);
    assert.match(css, /\.dsc-shot\{/);
    assert.match(css, /\.dsc-shot\.has-ratio img,\.dsc-shot\.has-ratio video\{[^}]*object-fit:cover/s);
    const src = read('src/app/Discover.jsx');
    assert.doesNotMatch(src, /wk-shot/, 'the profile class must not leak onto the feed');
    assert.match(src, /wk-count/, 'a carousel still uses the existing count marker');
    const works = read('src/app/Works.jsx');
    assert.doesNotMatch(works, /cellAspect/, 'the grid must not consult a per-post ratio');
    assert.doesNotMatch(works, /aspectRatio/, 'no inline per-cell shape');
    assert.doesNotMatch(works, /feedAspect/, 'the grid must not start reading the feed helper');
  });
});

describe('the window, the invite, and the trap are the ones already built', () => {
  test('cancelling the window uploads nothing', () => {
    const src = read('src/app/CreatePost.jsx');
    const shareAt = src.indexOf('async function share');
    const discardAt = src.indexOf('function discard');
    assert.ok(shareAt > 0 && discardAt > 0);
    const share = src.slice(shareAt, src.indexOf('\n  const previewAspect'));
    const rest = src.slice(0, shareAt) + src.slice(shareAt + share.length);
    assert.match(share, /api\.createWork/);
    assert.match(share, /api\.uploadMedia/);
    assert.doesNotMatch(rest, /api\.createWork/);
    assert.doesNotMatch(rest, /api\.uploadMedia/);
    const discard = src.slice(discardAt, shareAt);
    assert.doesNotMatch(discard, /api\./, 'Cancel must not talk to the server');
    assert.match(discard, /onClose\(\)/);
  });

  test('the file input is no longer the commit, and the empty state is an invitation', () => {
    const src = read('src/app/Works.jsx');
    assert.doesNotMatch(src, /async function addFiles/);
    assert.doesNotMatch(src, /onChange=\{addFiles\}/);
    assert.match(src, /CreatePost/);
    assert.match(src, /Share your first photo/);
  });

  test('CreatePost reuses WorkDetail\'s trap rather than writing a second one', () => {
    const dialog = read('src/app/dialog.js');
    assert.match(dialog, /export function trapFocus/);
    assert.match(read('src/app/WorkDetail.jsx'), /from '\.\/dialog'/);
    assert.match(read('src/app/CreatePost.jsx'), /from '\.\/dialog'/);
    assert.match(read('src/app/CreatePost.jsx'), /role="dialog"/);
    assert.match(read('src/app/WorkDetail.jsx'), /role="dialog"/);
  });

  test('the square is KEPT: the grid is uniform and reads no per-post ratio', () => {
    // This test was originally the opposite — "the hardcoded square is gone". It asserted the
    // regression. The square IS the feature: "the photo display in profile will be unified in
    // profile". The cell must not be reshaped per post, and must not be an inline style either,
    // because one shape for the whole grid has nothing to compute.
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-shot\{[^}]*aspect-ratio:1/s);
    const src = read('src/app/Works.jsx');
    assert.doesNotMatch(src, /cellAspect/, 'the grid must not consult a per-post ratio');
    assert.doesNotMatch(src, /aspectRatio/, 'no inline per-cell shape');
  });

  test('WorkDetail still opens the photograph at its true shape, not the grid crop', () => {
    const src = read('src/app/WorkDetail.jsx');
    assert.match(src, /const ratio = current\?\.ratio/);
    assert.doesNotMatch(src, /cellAspect/);
    assert.doesNotMatch(src, /stageStyle\(work\.ratio\)/);
  });
});
