/**
 * The compose window gives the photograph the stage, and everything else serves it.
 *
 * Source-reading, because this is layout and weight: a control sitting ON the picture,
 * a second Cancel, a location box louder than the caption, an orphan invite under the
 * empty-state card. Those are the things that shipped as "it doesn't look good".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

describe('the picture is the hero, and the controls do not cover it', () => {
  test('the stage is a full-width band; zoom is not painted over it', () => {
    const src = read('src/app/CreatePost.jsx');
    const css = read('src/app/app.css');
    assert.match(src, /className="cp-hero"/);
    assert.match(src, /className="cp-tools"/);
    assert.match(css, /\.cp-hero\{/);
    // The stage is BOUNDED, not a fixed number. 420px/46vh was the first guess and it pushed the
    // location row and the Share button off a 1440x900 screen — found by screenshotting the real
    // window, which is the only thing that could have found it. Pinning the exact value would make
    // the next honest adjustment look like a regression.
    assert.match(css, /--cp-stage:min\(\d+px,\d+vh\)/);
    // The old overlay: position:absolute on .cp-zoom, with a gradient eating the bottom
    // third of an already-small thumbnail. Below the image, never over it.
    const zoomRule = css.match(/\.cp-zoom\{[^}]+\}/)?.[0] || '';
    assert.match(zoomRule, /display:flex/);
    assert.doesNotMatch(zoomRule, /position:absolute/,
      'a framing control must not cover the frame');
    assert.doesNotMatch(css, /\.cp-zoom\{[^}]*position:absolute/s);
  });

  test('Add more is the last tile in the film strip, never pinned to the far right', () => {
    const src = read('src/app/CreatePost.jsx');
    const css = read('src/app/app.css');
    const stripAt = src.indexOf('className="cp-strip"');
    assert.ok(stripAt > 0, 'there is a film strip');
    const addAt = src.indexOf('className="cp-add-more"');
    assert.ok(addAt > stripAt, 'Add more sits inside the strip, after the pictures it extends');
    assert.match(css, /\.cp-add-more\{[^}]*flex:0 0 64px/s);
    assert.doesNotMatch(css, /\.cp-stage\{/,
      'the old row — thumbnail, void, dashed box on the right — is gone');
  });

  test('the header close is a mark; the worded Cancel sits beside Share', () => {
    const src = read('src/app/CreatePost.jsx');
    assert.match(src, /aria-label="Cancel"/);
    assert.match(src, /className="app-link cp-dismiss"/);
    const head = src.slice(src.indexOf('wk-detail-head'), src.indexOf('cp-body'));
    assert.doesNotMatch(head, />Cancel</, 'two identical words in one window is a choice twice');
    assert.match(head, /aria-label="Cancel">\s*×/);
    // The class gained cp-actions when the row was pinned, so match the prefix rather than the
    // whole attribute — a test that breaks on an added class is testing the string, not the rule.
    const row = src.slice(src.indexOf('className="cp-row'));
    assert.match(row, />\s*Cancel\s*</);
  });

  test('the modal scrolls its body at 88vh, never the page', () => {
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-detail\.cp\{[^}]*max-height:88vh/s);
    assert.match(css, /\.wk-detail\.cp\{[^}]*overflow:hidden/s);
    assert.match(css, /\.cp-body\{[^}]*overflow-y:auto/s);
  });

  test('location is as quiet as the caption — no heavy box around an optional field', () => {
    const css = read('src/app/app.css');
    const place = css.match(/\.cp-place\{[^}]+\}/)?.[0] || '';
    assert.match(place, /border:none/);
    assert.doesNotMatch(place, /border:1px solid var\(--line\)/,
      'a border around location made it louder than the caption');
  });

  test('CreatePost did not grow a title field', () => {
    const src = read('src/app/CreatePost.jsx');
    assert.doesNotMatch(src, /placeholder="Title/);
    assert.doesNotMatch(src, /text\.title/);
    assert.match(src, /title: ''/, 'the API still receives an empty title; the author never types one');
  });
});

describe('the profile empty state is one invitation', () => {
  test('the invite wording lives inside the card; the orphan line is gone', () => {
    const src = read('src/app/Works.jsx');
    assert.match(src, /Share your first photo/);
    assert.doesNotMatch(src, /wk-invite/,
      'a second call to action under the card reads as debris, not an invitation');
    const add = src.slice(src.indexOf('className="wk-add"'), src.indexOf('works === null'));
    assert.match(add, /spec\.invite/, 'the sentence is the button\'s explanation, inside the card');
  });

  test('the profile grid is still square — do not reintroduce cdda5cb', () => {
    const css = read('src/app/app.css');
    assert.match(css, /\.wk-shot\{[^}]*aspect-ratio:1/s);
    const works = read('src/app/Works.jsx');
    assert.doesNotMatch(works, /cellAspect/);
    assert.doesNotMatch(works, /aspectRatio/);
    assert.doesNotMatch(works, /feedAspect/);
  });
});
