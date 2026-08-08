/**
 * Pilot guard uses Corridor's mandate-rules.ts — these tests prove the shared site.
 *   node --test test/guard.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMandates } from '../server/guard.mjs';

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
    counterpartyTier: 'T1',
  });
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
