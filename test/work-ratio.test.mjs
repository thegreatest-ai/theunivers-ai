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
import { parseWorkRatio, ratioAspect, cellAspect, WORK_RATIOS } from '../shared/work-ratio.mjs';

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

describe('the grid cell reads the post, not each image', () => {
  test('a chosen ratio wins over every slide', () => {
    const work = {
      ratio: '4:5',
      media: [{ ratio: 1.5 }, { ratio: 0.5 }],
    };
    assert.equal(cellAspect(work), 4 / 5);
    assert.notEqual(cellAspect(work), work.media[0].ratio);
    assert.notEqual(cellAspect(work), work.media[1].ratio);
  });

  test('a work created before this change (ratio NULL) uses the photograph', () => {
    const work = { ratio: null, media: [{ ratio: 1.3333 }] };
    assert.equal(cellAspect(work), 1.3333);
  });

  test('absent dimensions do not become a zero-height box', () => {
    assert.equal(cellAspect({ ratio: null, media: [{ ratio: null }] }), undefined);
    assert.equal(cellAspect({ ratio: null, media: [] }), undefined);
    assert.equal(cellAspect({ ratio: null }), undefined);
    assert.equal(cellAspect({ ratio: '1:1', media: [{ ratio: 0 }] }), 1);
  });

  test('Original has no aspect of its own', () => {
    assert.equal(ratioAspect('original'), null);
    assert.equal(ratioAspect(null), null);
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
    assert.match(src, /cellAspect/);
  });

  test('CreatePost reuses WorkDetail\'s trap rather than writing a second one', () => {
    const dialog = read('src/app/dialog.js');
    assert.match(dialog, /export function trapFocus/);
    assert.match(read('src/app/WorkDetail.jsx'), /from '\.\/dialog'/);
    assert.match(read('src/app/CreatePost.jsx'), /from '\.\/dialog'/);
    assert.match(read('src/app/CreatePost.jsx'), /role="dialog"/);
    assert.match(read('src/app/WorkDetail.jsx'), /role="dialog"/);
  });

  test('the hardcoded square is gone; the cell takes work.ratio', () => {
    const css = read('src/app/app.css');
    assert.doesNotMatch(css, /\.wk-shot\{[^}]*aspect-ratio:1/s);
    assert.match(css, /\.wk-shot\.has-ratio/);
    assert.match(read('src/app/Works.jsx'), /cellAspect\(w\)/);
  });

  test('WorkDetail still opens the photograph at its true shape, not the grid crop', () => {
    const src = read('src/app/WorkDetail.jsx');
    assert.match(src, /const ratio = current\?\.ratio/);
    assert.doesNotMatch(src, /cellAspect/);
    assert.doesNotMatch(src, /stageStyle\(work\.ratio\)/);
  });
});
