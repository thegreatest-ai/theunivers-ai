/**
 * The order state machine. Pure rules — no database, no session, no server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, TRANSITIONS, canTransition, transitionsFrom, isTerminal }
  from '../shared/order-states.mjs';

test('every transition names states that exist', () => {
  for (const t of TRANSITIONS) {
    assert.ok(STATES.includes(t.from), `${t.from} is not a state`);
    assert.ok(STATES.includes(t.to), `${t.to} is not a state`);
  }
});

test('the happy path runs end to end', () => {
  const path = [
    ['drafted', 'offered', 'buyer'], ['offered', 'accepted', 'seller'],
    ['accepted', 'awaiting_funding', 'system'], ['awaiting_funding', 'funded', 'system'],
    ['funded', 'shipped', 'seller'], ['shipped', 'delivered', 'buyer'],
    ['delivered', 'inspected', 'system'], ['inspected', 'settled', 'system'],
  ];
  for (const [from, to, role] of path) {
    assert.equal(canTransition(from, to, role).ok, true, `${from} → ${to} as ${role}`);
  }
});

test('the wrong party cannot move an order', () => {
  // A seller accepting their own offer would be both sides of the agreement.
  assert.equal(canTransition('drafted', 'offered', 'seller').code, 'WRONG_ACTOR');
  assert.equal(canTransition('offered', 'accepted', 'buyer').code, 'WRONG_ACTOR');
  assert.equal(canTransition('funded', 'shipped', 'buyer').code, 'WRONG_ACTOR');
});

test('either party may raise a dispute, an outsider may not', () => {
  for (const role of ['buyer', 'seller']) {
    assert.equal(canTransition('delivered', 'disputed', role).ok, true);
  }
  assert.equal(canTransition('delivered', 'disputed', 'system').code, 'WRONG_ACTOR');
});

test('terminal states are final', () => {
  for (const s of ['settled', 'withdrawn', 'resolved']) {
    assert.ok(isTerminal(s));
    assert.equal(transitionsFrom(s).length, 0, `${s} must have no way out`);
    assert.equal(canTransition(s, 'disputed', 'buyer').code, 'TERMINAL');
  }
});

test('states cannot be skipped', () => {
  // Settling straight from funded would skip delivery AND inspection — the two things the money
  // is waiting on.
  assert.equal(canTransition('funded', 'settled', 'system').code, 'NO_TRANSITION');
  assert.equal(canTransition('offered', 'shipped', 'seller').code, 'NO_TRANSITION');
  assert.equal(canTransition('drafted', 'accepted', 'seller').code, 'NO_TRANSITION');
});

test('an order cannot be withdrawn once funded', () => {
  // The platform never held the money, so it cannot give it back. Unwinding is a settlement
  // question between the parties and their provider, not a state we flip.
  for (const s of ['funded', 'shipped', 'delivered', 'inspected']) {
    assert.equal(canTransition(s, 'withdrawn', 'buyer').code, 'NO_TRANSITION', s);
  }
  assert.equal(canTransition('offered', 'withdrawn', 'buyer').ok, true);
});

test('exactly the two commitments are binding', () => {
  // Sending an offer commits the buyer; accepting commits the seller. Everything else reports a
  // fact and needs authority to act, not authority to commit.
  const binding = TRANSITIONS.filter((t) => t.binds).map((t) => `${t.from}→${t.to}`);
  assert.deepEqual(binding.sort(), ['drafted→offered', 'offered→accepted']);
});

test('every transition writes a receipt', () => {
  for (const t of TRANSITIONS) {
    assert.ok(t.receipt && t.receipt.includes('.'), `${t.from}→${t.to} has no receipt type`);
  }
});

test('unknown states are refused rather than assumed', () => {
  assert.equal(canTransition('nonsense', 'offered', 'buyer').code, 'BAD_STATE');
  assert.equal(canTransition('drafted', 'nonsense', 'buyer').code, 'BAD_STATE');
});
