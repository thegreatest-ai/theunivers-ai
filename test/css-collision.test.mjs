/**
 * The two stylesheets must not fight over the same property of the same class.
 *
 * `src/styles.css` dresses the cinematic marketing scroll; `src/app/app.css` dresses the Bridge.
 * BOTH LOAD ON /app. app.css opens by claiming "All classes are prefixed .app- so nothing can
 * collide with the cinematic site" — a claim nothing enforced, and which was false.
 *
 * `.act` was the collision that cost an afternoon. The marketing scroll gives it width:100vw and
 * min-height:100vh for its nine full-viewport sections; the product used the same name for the
 * share/comment/cited row. The row became exactly one viewport tall — 913px, measured — with
 * flex-direction:column and justify-content:center, so its controls sat hundreds of pixels below
 * the modal they belonged to. In the DOM. Reported "in view" by a bounding box. Invisible.
 *
 * WHAT THIS DOES NOT FORBID: sharing a class name to LAYER on it. `.sso-btn` is defined in both —
 * marketing gives it padding, background and border; the product adds flex alignment for the icon.
 * No property is set twice, the sign-in button is deliberately built that way, and a test that
 * failed on it would be turned off within a week.
 *
 * So the rule is the narrow, true one: the same bare class, setting the same property, in both.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');   // comments name classes without styling them

/** Bare `.foo{…}` rules only — `.a.b` and `.a .b` are conditional and cannot collide by accident. */
function bareRules(css) {
  const out = new Map();
  for (const m of css.matchAll(/(^|[},])\s*\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/g)) {
    const [, , name, body] = m;
    const props = new Set(
      body.split(';').map((d) => d.split(':')[0].trim()).filter(Boolean),
    );
    const prev = out.get(name) ?? new Set();
    for (const p of props) prev.add(p);
    out.set(name, prev);
  }
  return out;
}

test('the marketing sheet and the product sheet never set the same property of the same class', () => {
  const marketing = bareRules(read('src/styles.css'));
  const product = bareRules(read('src/app/app.css'));

  const clashes = [];
  for (const [name, props] of product) {
    const theirs = marketing.get(name);
    if (!theirs) continue;
    const both = [...props].filter((p) => theirs.has(p));
    if (both.length) clashes.push(`.${name} → ${both.join(', ')}`);
  }

  assert.deepEqual(clashes, [],
    `both stylesheets load on /app and these set the same property of the same class:\n  ${
      clashes.join('\n  ')}\nRename the product one — the marketing scroll had these names first.`);
});
