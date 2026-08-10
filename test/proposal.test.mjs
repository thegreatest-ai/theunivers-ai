/**
 * The proposal flow — what an agent may ask, and what it may never ask.
 *
 * These encode ADR-0001. The central property: a principal may supply a missing SCOPE, because
 * scope is a delegation question about what the AGENT may do alone. They may not supply a missing
 * FLOOR by tapping Approve, because that is a limit on the DEAL, and moving it through an approval
 * prompt is widening a mandate by chat.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../server/vendor/mandate-rules.ts';

const mandate = (over = {}) => ({
  scope: 'negotiate', commodity: 'olive oil',
  maxQuantity: { value: 40, unit: 't' }, consumed: { quantity: 0 },
  priceFloor: { amount: 200, currency: 'AED' },
  specTemplateId: 'default',
  deliveryWindow: { from: '1970-01-01', to: '9999-12-31' },
  counterpartyMinTier: 'T0', expiresAt: '9999-12-31T00:00:00.000Z',
  status: 'active', ...over,
});
const intent = (over = {}) => ({
  kind: 'accept', commodity: 'olive oil',
  price: { amount: 240, currency: 'AED' },
  quantity: { value: 5, unit: 't' }, specTemplateId: 'default', ...over,
});

/** The production test: would this pass if scope were the only thing missing? */
const scopeIsTheOnlyObstacle = (m, i) =>
  !evaluate([m], i).ok && evaluate([{ ...m, scope: 'commit' }], i).ok;

test('an accept the mandate otherwise allows is a scope escalation', () => {
  assert.equal(scopeIsTheOnlyObstacle(mandate(), intent()), true);
});

test('a below-floor accept is NOT a scope escalation', () => {
  // THE BUG THIS EXISTS TO PREVENT. evaluateOne checks scope BEFORE floor and short-circuits, so a
  // below-floor accept fails with code SCOPE and never reaches the floor rule. Testing the code
  // alone would classify a floor breach as "just needs approval" — and approving it would bypass
  // the floor entirely. Elevating scope is what separates the two.
  const i = intent({ price: { amount: 150, currency: 'AED' } });
  assert.equal(evaluate([mandate()], i).code, 'SCOPE', 'the mask that made this dangerous');
  assert.equal(scopeIsTheOnlyObstacle(mandate(), i), false, 'must NOT be approvable');
  assert.equal(evaluate([{ ...mandate(), scope: 'commit' }], i).code, 'FLOOR', 'the real reason');
});

test('other substantive limits are equally unapprovable', () => {
  const cases = {
    COMMODITY: intent({ commodity: 'steel coil' }),
    QUANTITY:  intent({ quantity: { value: 500, unit: 't' } }),
  };
  for (const [code, i] of Object.entries(cases)) {
    assert.equal(scopeIsTheOnlyObstacle(mandate(), i), false, `${code} must not be approvable`);
    assert.equal(evaluate([{ ...mandate(), scope: 'commit' }], i).code, code);
  }
});

test('an expired mandate is not approvable either', () => {
  const m = mandate({ expiresAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(scopeIsTheOnlyObstacle(m, intent()), false);
  assert.equal(evaluate([{ ...m, scope: 'commit' }], intent()).code, 'EXPIRED');
});

test('a mandate already granting commit needs no approval at all', () => {
  assert.equal(evaluate([mandate({ scope: 'commit' })], intent()).ok, true);
  assert.equal(scopeIsTheOnlyObstacle(mandate({ scope: 'commit' }), intent()), false);
});

test('quote-scope mandates escalate an ordinary offer', () => {
  const m = mandate({ scope: 'quote' });
  assert.equal(scopeIsTheOnlyObstacle(m, intent({ kind: 'offer' })), true);
});
