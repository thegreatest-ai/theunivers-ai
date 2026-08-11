/**
 * THE ORDERING, AS A TEST.
 *
 * A ranker with no tests drifts silently, because nothing about it fails loudly — a weight nudged
 * in the wrong direction still returns a list, in an order nobody can tell is wrong by looking.
 * The Facebook ranker weighted the angry reaction at five times a like for years, and the only
 * reason anyone found out was a document leak.
 *
 * The load-bearing test here is `the parts sum to the score`. Every other property can be
 * restored after a mistake; a hidden term cannot be, because by then the shown explanation and the
 * applied order are two different things and the interface is lying.
 *
 * The permission and no-infinite-scroll checks read the source, in the same style and for the same
 * reason as test/who-may.test.mjs: the suite stays dependency-free and cannot pass because a
 * server happened to be running.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rank, order, paginate, sideOf, WEIGHTS, PER_PAGE, MAX_PER_PAGE } from '../shared/ranking.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'server', 'index.mjs'), 'utf8');

const NOW = new Date('2026-08-11T12:00:00.000Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

/** A post with everything neutral, so each test moves exactly one thing. */
const post = (over = {}) => ({
  id: 'pst_1', type: 'result', lane: 'IN-AE', title: 'Onion consignment', body: 'Delivered.',
  cited: 0, tier: 'T0', at: hoursAgo(0), ...over,
});

const at = (r, name) => r.parts.find((p) => p.part === name);

/* ── the rule the whole design rests on ──────────────────────────────────────────────────── */

test('the parts sum to the score, exactly', () => {
  const r = rank(post({ cited: 7, tier: 'T3', at: hoursAgo(9) }),
    { now: NOW, watches: [{ commodity: 'onion', lane: 'IN-AE' }] });
  const sum = r.parts.reduce((n, p) => n + p.points, 0);
  assert.ok(Math.abs(sum - r.score) < 0.011, `parts sum to ${sum}, score says ${r.score}`);
});

test('every part carries a reason, and no part is silent', () => {
  const r = rank(post(), { now: NOW });
  assert.equal(r.parts.length, 4, 'four terms, and a fifth may not be added without a sentence');
  for (const p of r.parts) {
    assert.ok(p.because && p.because.length > 8, `${p.part} has no explanation`);
    assert.equal(typeof p.points, 'number');
    assert.ok(Number.isFinite(p.points), `${p.part} produced ${p.points}`);
  }
});

test('a term that scored nothing is still reported', () => {
  // "0 — nothing you watch matches this" is an explanation. Its absence is not, and a part that
  // vanishes when it is zero is a part nobody can check the arithmetic against.
  const r = rank(post(), { now: NOW, watches: [] });
  assert.equal(at(r, 'watched').points, 0);
  assert.match(at(r, 'watched').because, /saved a search/i);
});

/* ── citations, and what they are worth ──────────────────────────────────────────────────── */

test('citations are the only thing that lifts a post on merit', () => {
  const base = rank(post({ cited: 0 }), { now: NOW }).score;
  const cited = rank(post({ cited: 4 }), { now: NOW }).score;
  assert.ok(cited > base, 'being built on must move a post up');
});

test('citations have diminishing returns — enthusiasm is not corroboration', () => {
  const s = (n) => at(rank(post({ cited: n }), { now: NOW }), 'cited').points;
  const first = s(1) - s(0);
  const tenth = s(10) - s(9);
  assert.ok(first > tenth * 3,
    `the first citation (${first}) must be worth far more than the tenth (${tenth})`);
});

test('zero citations is zero points, never a penalty', () => {
  // A new post has not failed. Starting it below zero would make the feed a seniority list.
  assert.equal(at(rank(post({ cited: 0 }), { now: NOW }), 'cited').points, 0);
});

/* ── standing ────────────────────────────────────────────────────────────────────────────── */

test('standing helps and does not substitute for being used', () => {
  const t4NeverCited = rank(post({ tier: 'T4', cited: 0 }), { now: NOW }).score;
  const t0WellCited = rank(post({ tier: 'T0', cited: 12 }), { now: NOW }).score;
  assert.ok(t0WellCited > t4NeverCited,
    'a T0 whose work is used must beat a T4 whose work is not — otherwise this is a directory');
});

test('an unknown tier is treated as T0, not as an error and not as a bonus', () => {
  const r = rank(post({ tier: 'T9' }), { now: NOW });
  assert.equal(at(r, 'standing').points, 0);
  assert.match(at(r, 'standing').because, /T0/);
});

/* ── the one personalisation term ────────────────────────────────────────────────────────── */

test('only a search you saved yourself personalises the order', () => {
  const p = post({ title: 'Red onion, Nashik', lane: 'IN-AE' });
  const plain = rank(p, { now: NOW, watches: [] }).score;
  const watched = rank(p, { now: NOW, watches: [{ commodity: 'onion', lane: 'IN-AE' }] }).score;
  assert.equal(watched - plain,
    WEIGHTS.WATCH_COMMODITY_POINTS + WEIGHTS.WATCH_LANE_POINTS);
});

test('a watch that does not match adds nothing', () => {
  const p = post({ title: 'Ceramic tile', body: 'Morbi grade A', lane: 'IN-AE' });
  const r = rank(p, { now: NOW, watches: [{ commodity: 'onion', lane: 'AE-IN' }] });
  assert.equal(at(r, 'watched').points, 0);
});

test('the watch term names the watch, so the personalisation is legible', () => {
  const r = rank(post({ title: 'Red onion' }), { now: NOW, watches: [{ commodity: 'onion' }] });
  assert.match(at(r, 'watched').because, /onion/);
});

/* ── perishability ───────────────────────────────────────────────────────────────────────── */

test('age costs points, additively, so it can be printed beside the others', () => {
  const fresh = at(rank(post({ at: hoursAgo(0) }), { now: NOW }), 'age').points;
  const old = at(rank(post({ at: hoursAgo(48) }), { now: NOW }), 'age').points;
  assert.equal(fresh, 0);
  assert.ok(old < 0);
  // Linear: twice the age is twice the cost. A decay curve cannot be stated as a number of points.
  const half = at(rank(post({ at: hoursAgo(24) }), { now: NOW }), 'age').points;
  assert.ok(Math.abs(old - half * 2) < 0.02, 'the age term must stay linear');
});

test('a price signal goes stale faster than a result', () => {
  const age = (type) => at(rank(post({ type, at: hoursAgo(12) }), { now: NOW }), 'age').points;
  assert.ok(age('price_signal') < age('availability'));
  assert.ok(age('availability') < age('result'));
});

test('a post from the future does not earn a bonus', () => {
  // Clock skew between a client and the server is normal; a negative age becoming positive points
  // would make "post-date it" a ranking strategy.
  const r = rank(post({ at: new Date(NOW.getTime() + 86_400_000).toISOString() }), { now: NOW });
  assert.equal(at(r, 'age').points, 0);
});

test('an unknown post type still decays', () => {
  const r = rank(post({ type: 'something_new', at: hoursAgo(24) }), { now: NOW });
  assert.ok(at(r, 'age').points < 0, 'a new type must not be immortal by default');
});

/* ── nothing that could be farmed by reaction is in here at all ──────────────────────────── */

test('no engagement metric appears anywhere in the ranker', () => {
  const src = readFileSync(join(ROOT, 'shared', 'ranking.mjs'), 'utf8');
  // Comments in that file discuss what is refused, so this checks the CODE below the prose block.
  const code = src.slice(src.indexOf('const CITATION_WEIGHT'));
  for (const banned of ['like', 'follow', 'dwell', 'reaction', 'clicks', 'impression']) {
    assert.doesNotMatch(code, new RegExp(`\\b${banned}s?\\b`, 'i'),
      `"${banned}" must not be a ranking input — see docs/design/DISCOVERY-RESEARCH.md`);
  }
});

test('views are not an input, even though the feed reports them', () => {
  const withViews = rank({ ...post(), views: { people: 900, agents: 900 } }, { now: NOW });
  assert.equal(withViews.score, rank(post(), { now: NOW }).score);
});

/* ── ordering and ties ───────────────────────────────────────────────────────────────────── */

test('order is highest first, and a tie breaks on recency rather than insertion', () => {
  const rows = [
    { id: 'a', score: 5, at: hoursAgo(10) },
    { id: 'b', score: 9, at: hoursAgo(10) },
    { id: 'c', score: 5, at: hoursAgo(1) },
  ];
  assert.deepEqual(order(rows).map((r) => r.id), ['b', 'c', 'a']);
});

test('order does not mutate what it was given', () => {
  const rows = [{ id: 'a', score: 1, at: hoursAgo(1) }, { id: 'b', score: 2, at: hoursAgo(1) }];
  order(rows);
  assert.equal(rows[0].id, 'a');
});

/* ── pagination that cannot become infinite scroll ───────────────────────────────────────── */

test('a page has a number, a total and a last one', () => {
  const rows = Array.from({ length: 45 }, (_, i) => i);
  const p = paginate(rows, 2, 20);
  assert.equal(p.page, 2);
  assert.equal(p.pages, 3);
  assert.equal(p.total, 45);
  assert.equal(p.rows.length, 20);
  assert.equal(p.rows[0], 20);
});

test('the page size has a real ceiling', () => {
  // ?per=100000 is exactly how a paginated endpoint becomes an unpaginated one.
  assert.equal(paginate(Array.from({ length: 500 }), 1, 100_000).per, MAX_PER_PAGE);
  assert.equal(paginate(Array.from({ length: 500 }), 1, 0).per, PER_PAGE);
  assert.equal(paginate(Array.from({ length: 500 }), 1, 'banana').per, PER_PAGE);
});

test('a page out of range lands on a real page, never on nothing', () => {
  const rows = Array.from({ length: 10 }, (_, i) => i);
  assert.equal(paginate(rows, 99, 20).page, 1);
  assert.equal(paginate(rows, -3, 20).page, 1);
  assert.equal(paginate([], 1, 20).pages, 1);
});

test('no scroll listener fetches more, anywhere in the app', () => {
  // The position, as a test. Infinite scroll is added by accident far more often than on purpose —
  // one `onScroll` that calls the next page and the stopping cue is gone.
  /*
   * EVERY component, found by reading the directory rather than a hand-written list. The first
   * version named Bridge.jsx; another agent renamed it to Home.jsx in the same integration, and the
   * test then failed on a missing file instead of on the thing it guards. A named list also stops
   * covering whatever is added next — it fails open, which is the worse direction.
   */
  const dir = join(ROOT, 'src/app');
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.jsx'))) {
    const f = `src/app/${name}`;
    const src = readFileSync(join(dir, name), 'utf8');
    assert.doesNotMatch(src, /addEventListener\(\s*['"]scroll/, `${f} listens to scroll`);
    assert.doesNotMatch(src, /IntersectionObserver/, `${f} uses an infinite-scroll sentinel`);
    assert.doesNotMatch(src, /onScroll/, `${f} has a scroll handler`);
  }
});

/* ── side of the market ──────────────────────────────────────────────────────────────────── */

test('supply and demand are derived from the type, never stored', () => {
  assert.equal(sideOf('availability'), 'supply');
  assert.equal(sideOf('requirement'), 'demand');
  assert.equal(sideOf('result'), null, 'a result is neither, and must not be forced into one');
  assert.equal(sideOf('nonsense'), null);
});

/* ── the server keeps its half of the bargain ────────────────────────────────────────────── */

/** The body of one route handler, so a guard in a neighbour cannot be mistaken for this one. */
function routeBody(method, path) {
  const start = SERVER.indexOf(`route('${method}', '${path}'`);
  assert.notEqual(start, -1, `${method} ${path} is not registered`);
  const next = SERVER.indexOf("\nroute('", start + 1);
  return SERVER.slice(start, next === -1 ? SERVER.length : next);
}

test('the feed sends the explanation, not only the order', () => {
  const body = routeBody('GET', '/api/feed');
  assert.match(body, /score,\s*why: parts/,
    'every post must carry the parts that produced its position');
  assert.match(body, /paginate\(/, 'the feed must be paginated');
});

test('the feed ranks with the shared rules rather than its own copy', () => {
  assert.match(SERVER, /from '\.\.\/shared\/ranking\.mjs'/,
    'a second copy of the weights would drift, exactly as the mandate rules once did');
});

test('the ranker reads watches and never writes one', () => {
  const body = routeBody('GET', '/api/feed');
  assert.match(body, /SELECT label, commodity, lane FROM watch/);
  assert.doesNotMatch(body, /INSERT INTO watch|UPDATE watch/,
    'a ranker that edits your saved searches is the follow-graph effect the Nature study found');
});

test('discover scopes works by shareable when an agent is asking', () => {
  const body = routeBody('GET', '/api/discover');
  assert.match(body, /asAgent \|\| w\.shareable === 1 \|\| w\.user_id === viewerId/,
    'an agent must not be handed a work whose author withheld it from being built on');
  assert.match(body, /const asAgent = Boolean\(ctx\.agent && !ctx\.user\)/,
    'the scope must be derived from the credential, never from the request');
});

test('reading a profile directly is scoped the same way as searching it', () => {
  // The hole this closes: an agent asked GET /api/works?user=<stranger> and was handed a work its
  // author had marked "not for sharing". Scoping the search while leaving the endpoint the search
  // is a view over wide open is theatre.
  const body = routeBody('GET', '/api/works');
  assert.match(body, /ctx\.agent && !ctx\.user && userId !== ctx\.agent\.user_id/,
    'an agent reading someone ELSE\'s profile must be scoped');
  assert.match(body, /rows\.filter\(\(w\) => w\.shareable === 1\)/);
});

test('discover echoes the filters it applied', () => {
  // A filter the server silently dropped reads as "no results", and sends someone hunting for
  // content that was there the whole time.
  assert.match(routeBody('GET', '/api/discover'), /applied: \{/);
});
