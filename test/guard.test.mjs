/**
 * Pilot guard uses Corridor's mandate-rules.ts — these tests prove the shared site.
 *   node --test test/guard.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMandates } from '../server/guard.mjs';
import { derive } from '../server/vendor/trust-rules.ts';

const baseRow = {
  status: 'active',
  scope: 'negotiate',
  commodity: 'onion-red',
  price_floor: 18,
  currency: 'INR',
  max_quantity: JSON.stringify({ value: 40, unit: 't' }),
  consumed: JSON.stringify({ quantity: 0 }),
  delivery_window: JSON.stringify({ from: '2026-01-01', to: '2026-12-31' }),
  counterparty_min_tier: 'T2',
  expires_at: '2027-01-01T00:00:00.000Z',
  spec_template_id: 'onion-red-v1',
};

test('shared guard: FLOOR', () => {
  const r = checkMandates([baseRow], {
    kind: 'offer',
    commodity: 'onion-red',
    quantity: { value: 10, unit: 't' },
    price: { amount: 15, currency: 'INR' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'FLOOR');
});

test('shared guard: QUANTITY', () => {
  const r = checkMandates([baseRow], {
    kind: 'offer',
    commodity: 'onion-red',
    quantity: { value: 500, unit: 't' },
    price: { amount: 25, currency: 'INR' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'QUANTITY');
});

test('shared guard: EXPIRED', () => {
  const r = checkMandates([{ ...baseRow, expires_at: '2020-01-01T00:00:00.000Z' }], {
    kind: 'offer',
    commodity: 'onion-red',
    quantity: { value: 10, unit: 't' },
    price: { amount: 25, currency: 'INR' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EXPIRED');
});

test('shared guard: SCOPE', () => {
  const r = checkMandates([baseRow], {
    kind: 'accept',
    commodity: 'onion-red',
    quantity: { value: 5, unit: 't' },
    price: { amount: 25, currency: 'INR' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SCOPE');
});

test('shared guard: COUNTERPARTY_TIER', () => {
  const r = checkMandates([baseRow], {
    kind: 'offer',
    commodity: 'onion-red',
    quantity: { value: 10, unit: 't' },
    price: { amount: 25, currency: 'INR' },
  }, { counterpartyTier: 'T1' });   // resolved by the caller, never taken from the body
  assert.equal(r.ok, false);
  assert.equal(r.code, 'COUNTERPARTY_TIER');
});

test('shared guard: CEILING', () => {
  const r = checkMandates([{ ...baseRow, price_floor: null, price_ceiling: 30 }], {
    kind: 'offer',
    commodity: 'onion-red',
    quantity: { value: 10, unit: 't' },
    price: { amount: 40, currency: 'INR' },
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CEILING');
});

test('shared guard: allow when within envelope', () => {
  const r = checkMandates([baseRow], {
    kind: 'offer',
    commodity: 'onion-red',
    quantity: { value: 10, unit: 't' },
    price: { amount: 21, currency: 'INR' },
    counterpartyTier: 'T3',
  });
  assert.equal(r.ok, true);
});

test('shared guard: legacy numeric price still FLOORs', () => {
  const r = checkMandates([baseRow], {
    kind: 'offer',
    commodity: 'onion-red',
    price: 15,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'FLOOR');
});

// ── Trust derivation (invariant 1) ────────────────────────────────────────────────────────
// These exist because COUNTERPARTY_TIER was inert in production for two days while its own
// test passed. The rule was fine; nothing derived a tier to feed it.

test('trust: no anchors means T0 — an account is not standing', () => {
  const r = derive([], [], 0);
  assert.equal(r.tier, 'T0');
});

test('trust: a vouch from an institution reaches T2, the transactable line', () => {
  const r = derive(
    [{ type: 'fpo_membership', method: 'vouch', status: 'verified' }], [], 30);
  assert.equal(r.tier, 'T2');
});

test('trust: an EXPIRED anchor stops counting', () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const r = derive(
    [{ type: 'trade_licence', method: 'api', status: 'verified', expiresAt: yesterday }], [], 400);
  assert.equal(r.tier, 'T0', 'a lapsed licence must lower standing, not linger');
});

test('trust: a clean delivery record lifts T2 to T3', () => {
  const receipts = ['payment.released','payment.released','payment.released',
                    'payment.released','payment.released','inspection.passed'];
  const r = derive([{ type: 'trade_licence', method: 'api', status: 'verified' }], receipts, 200);
  assert.equal(r.tier, 'T3');
});

test('trust: a dispute holds it at T2', () => {
  const receipts = ['payment.released','payment.released','payment.released',
                    'payment.released','payment.released','inspection.passed','dispute.opened'];
  const r = derive([{ type: 'trade_licence', method: 'api', status: 'verified' }], receipts, 200);
  assert.equal(r.tier, 'T2');
});

test('trust: score is rate-based — disputes outweigh volume', () => {
  const many = Array(40).fill('payment.released').concat(Array(5).fill('dispute.opened'));
  const few  = Array(20).fill('payment.released');
  const anchor = [{ type: 'trade_licence', method: 'api', status: 'verified' }];
  assert.ok(derive(anchor, few, 200).score > derive(anchor, many, 200).score,
    'a 45-deal trader with 5 disputes must rank below a clean 20-deal supplier');
});
