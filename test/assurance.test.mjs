/**
 * Assurance grading — the arithmetic that decides what an inspection's evidence is worth.
 *
 * The whole reason this is a grade and not a boolean: `navigator.geolocation` is spoofable, so a
 * single reported position proves nothing. The grade is CONSISTENCY between the device fix and an
 * independent network fix. These tests pin the conservative behaviour — any missing or
 * inconsistent signal drops to `self` — because over-crediting evidence is the worst failure for a
 * product whose thesis is receipts you can trust.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVELS, rank, meets, grade, haversineKm, CONSISTENCY_RADIUS_KM, RESPONSE_WINDOW_MS,
} from '../shared/assurance.mjs';

const DUBAI = { lat: 25.2048, lng: 55.2708 };
const NEAR_DUBAI = { lat: 25.34, lng: 55.42 };   // ~22km — same emirate
const HOUSTON = { lat: 29.7604, lng: -95.3698 };  // the spoof from the spec

test('levels are ordered weakest to strongest', () => {
  assert.deepEqual(LEVELS, ['self', 'web-attested', 'device-attested']);
  assert.ok(rank('self') < rank('web-attested'));
  assert.ok(rank('web-attested') < rank('device-attested'));
  assert.equal(rank('nonsense'), -1);
});

test('meets() compares by rank, and an unknown level never satisfies a policy', () => {
  assert.ok(meets('web-attested', 'web-attested'));
  assert.ok(meets('device-attested', 'web-attested'));
  assert.ok(!meets('self', 'web-attested'));
  assert.ok(!meets('nonsense', 'self'));
});

test('haversine puts a near-Dubai point inside the radius and Houston far outside', () => {
  assert.ok(haversineKm(DUBAI, NEAR_DUBAI) < CONSISTENCY_RADIUS_KM);
  assert.ok(haversineKm(DUBAI, HOUSTON) > 10000);
});

test('a live, nonce-bearing, consistent capture earns web-attested', () => {
  const g = grade({
    live: true, nonce: '7K4Q', nonceInShot: true,
    device: { ...DUBAI, accuracy_m: 18 }, network: NEAR_DUBAI,
    requestedAt: '2026-08-10T14:32:00Z', observedAt: '2026-08-10T14:32:07Z',
  });
  assert.equal(g.level, 'web-attested');
  assert.ok(g.consistent);
});

test('web is the ceiling for a browser — it never reaches device-attested', () => {
  const g = grade({
    live: true, nonce: 'AB12', nonceInShot: true,
    device: DUBAI, network: NEAR_DUBAI,
  });
  assert.notEqual(g.level, 'device-attested');
});

test('a file, not a live frame, collapses to self', () => {
  const g = grade({ live: false, nonce: 'AB12', nonceInShot: true, device: DUBAI, network: DUBAI });
  assert.equal(g.level, 'self');
  assert.ok(g.reasons.some((r) => /not live/.test(r)));
});

test('a missing or unseen nonce collapses to self', () => {
  assert.equal(grade({ live: true, nonce: null, device: DUBAI, network: DUBAI }).level, 'self');
  assert.equal(
    grade({ live: true, nonce: 'AB12', nonceInShot: false, device: DUBAI, network: DUBAI }).level,
    'self');
});

test('the Houston spoof: device and network disagree, so it collapses to self and says why', () => {
  // The device claims Houston; the network (derived independently at the edge) says Dubai. This is
  // the exact attack the design is built around — and inconsistency is affirmative evidence of a
  // forged signal, not merely a failure to upgrade.
  const g = grade({
    live: true, nonce: 'AB12', nonceInShot: true,
    device: HOUSTON, network: DUBAI,
  });
  assert.equal(g.level, 'self');
  assert.ok(!g.consistent);
  assert.ok(g.reasons.some((r) => /disagree/.test(r)));
});

test('missing either position cannot be graded above self', () => {
  assert.equal(grade({ live: true, nonce: 'AB12', nonceInShot: true, device: DUBAI }).level, 'self');
  assert.equal(grade({ live: true, nonce: 'AB12', nonceInShot: true, network: DUBAI }).level, 'self');
});

test('a late but consistent response is still web-attested, with the delay on the record', () => {
  const requestedAt = '2026-08-10T14:00:00Z';
  const observedAt = new Date(Date.parse(requestedAt) + RESPONSE_WINDOW_MS + 60000).toISOString();
  const g = grade({
    live: true, nonce: 'AB12', nonceInShot: true,
    device: DUBAI, network: NEAR_DUBAI, requestedAt, observedAt,
  });
  // Not silently downgraded: the honest explanation (bad connection) and the dishonest one (time
  // to fabricate) produce the same number, so the receipt carries the fact and a human weighs it.
  assert.equal(g.level, 'web-attested');
  assert.ok(g.reasons.some((r) => /after the request/.test(r)));
});
