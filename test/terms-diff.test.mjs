/**
 * "I asked for 1, 2, 3 and it came back 1, 4, 3."
 *
 * The guard cannot answer that. A counter-offer may sit comfortably inside the mandate — allowed,
 * signed, and containing a term nobody agreed to. **Allowed is not the same as unchanged**, and the
 * whole point of this module is that a person is shown the difference before they approve.
 *
 * These tests are pure: no database, no server. That is deliberate, because this comparison is
 * imported by both the browser and the server, and the highlight a person reads has to be produced
 * by the same call that produced the verdict.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { compareTerms, compareToMandate, review } from '../shared/terms-diff.mjs';

const ours = {
  commodity: 'red onion',
  price: { amount: 15, currency: 'AED' },
  quantity: { value: 40, unit: 't' },
  deliveryDate: '2026-08-20',
};
const mandate = {
  commodity: 'red onion',
  priceFloor: { amount: 12, currency: 'AED' },
  priceCeiling: { amount: 20, currency: 'AED' },
  maxQuantity: { value: 40, unit: 't' },
  deliveryWindow: { from: '2026-08-01', to: '2026-08-31' },
  counterpartyMinTier: 'T2',
};

describe('what moved', () => {
  test('an identical counter-offer reports nothing changed', () => {
    const r = review({ ours, theirs: { ...ours }, mandate });
    assert.equal(r.verdict, 'unchanged');
    assert.deepEqual(r.changes, []);
    assert.match(r.summary, /nothing changed/);
  });

  test('THE CASE: one term moved, and it is still inside the mandate', () => {
    // 15 -> 13. Legal under a floor of 12, and not what was asked for.
    const theirs = { ...ours, price: { amount: 13, currency: 'AED' } };
    const r = review({ ours, theirs, mandate, side: 'seller' });

    assert.equal(r.verdict, 'changed', 'the guard would say yes; the person must still be shown');
    assert.equal(r.breaches.length, 0, 'nothing is outside the mandate');
    assert.equal(r.approvable, true);

    const price = r.changes.find((c) => c.field === 'price');
    assert.equal(price.before, '15 AED');
    assert.equal(price.after, '13 AED');
    assert.equal(price.worse, true, 'a seller loses when the price falls');
    assert.match(r.summary, /1 term changed/);
  });

  test('the same move is BETTER for the buyer, and says so', () => {
    const theirs = { ...ours, price: { amount: 13, currency: 'AED' } };
    const r = review({ ours, theirs, mandate, side: 'buyer' });
    assert.equal(r.changes.find((c) => c.field === 'price').worse, false);
  });

  test('several terms moving are all reported, not just the first', () => {
    const theirs = {
      ...ours,
      price: { amount: 13, currency: 'AED' },
      quantity: { value: 25, unit: 't' },
      deliveryDate: '2026-08-28',
    };
    const r = review({ ours, theirs, mandate });
    assert.deepEqual(r.changes.map((c) => c.field).sort(), ['deliveryDate', 'price', 'quantity']);
    assert.match(r.summary, /3 terms changed/);
  });

  test('quantity is reported as changed but never judged better or worse', () => {
    const theirs = { ...ours, quantity: { value: 25, unit: 't' } };
    const q = review({ ours, theirs, mandate }).changes.find((c) => c.field === 'quantity');
    assert.equal(q.changed, true);
    assert.equal(q.worse, null, 'more or less may suit either side; a guess here would be confident and wrong');
  });

  test('a changed unit is a change, even at the same number', () => {
    const theirs = { ...ours, quantity: { value: 40, unit: 'kg' } };
    assert.ok(review({ ours, theirs, mandate }).changes.some((c) => c.field === 'quantity'));
  });
});

describe('what is outside the mandate', () => {
  test('below the floor is a breach, and names the floor', () => {
    const theirs = { ...ours, price: { amount: 9, currency: 'AED' } };
    const r = review({ ours, theirs, mandate });
    assert.equal(r.verdict, 'breaches');
    assert.equal(r.approvable, false, 'a breach is never approvable here — it goes back to the mandate');
    assert.match(r.breaches[0].why, /below your floor of 12/);
  });

  test('above the ceiling is a breach', () => {
    const theirs = { ...ours, price: { amount: 25, currency: 'AED' } };
    assert.match(review({ ours, theirs, mandate }).breaches[0].why, /above your ceiling of 20/);
  });

  test('too much quantity is a breach', () => {
    const theirs = { ...ours, quantity: { value: 60, unit: 't' } };
    assert.match(review({ ours, theirs, mandate }).breaches[0].why, /exceeds the 40 you allowed/);
  });

  test('delivery outside the window is a breach at both ends', () => {
    const early = review({ ours, theirs: { ...ours, deliveryDate: '2026-07-01' }, mandate });
    assert.match(early.breaches[0].why, /before your window opens/);
    const late = review({ ours, theirs: { ...ours, deliveryDate: '2026-09-15' }, mandate });
    assert.match(late.breaches[0].why, /after your window closes/);
  });

  test('a counterparty below the tier you asked for is a breach', () => {
    const theirs = { ...ours, counterpartyTier: 'T1' };
    assert.match(review({ ours, theirs, mandate }).breaches[0].why, /they are T1; you asked for T2/);
  });

  test('a different commodity is a breach, not a change', () => {
    const theirs = { ...ours, commodity: 'white onion' };
    const r = review({ ours, theirs, mandate });
    assert.equal(r.verdict, 'breaches');
    assert.match(r.breaches[0].why, /covers red onion, these terms are for white onion/);
  });

  test('a breach with NOTHING changed is still a breach', () => {
    // The mandate narrowed under a deal agreed earlier — a real case, and invisible to a diff
    // that only looked at what moved.
    const narrowed = { ...mandate, priceFloor: { amount: 18, currency: 'AED' } };
    const r = review({ ours, theirs: { ...ours }, mandate: narrowed });
    assert.equal(r.changes.length, 0);
    assert.equal(r.verdict, 'breaches');
    assert.equal(r.approvable, false);
  });
});

describe('it reports and never permits', () => {
  test('compareToMandate returns only breaches — it has no way to say yes', () => {
    const clean = compareToMandate(ours, mandate);
    assert.deepEqual(clean, [], 'silence is the only "allowed" it can express');
  });

  test('a missing mandate does not fabricate approval', () => {
    const r = review({ ours, theirs: { ...ours, price: { amount: 1, currency: 'AED' } }, mandate: null });
    // Nothing to compare against, so nothing is claimed to be within anything.
    assert.deepEqual(r.breaches, []);
    assert.equal(r.verdict, 'changed', 'the CHANGE is still reported, which is the half it can know');
  });

  test('absent terms are not treated as zero', () => {
    const r = review({ ours: {}, theirs: {}, mandate });
    assert.deepEqual(r.changes, []);
    assert.deepEqual(r.breaches, []);
    assert.equal(r.verdict, 'unchanged');
  });

  test('comparing against nothing at all does not throw', () => {
    assert.equal(review({}).verdict, 'unchanged');
    assert.deepEqual(compareTerms(null, null), []);
  });
});
