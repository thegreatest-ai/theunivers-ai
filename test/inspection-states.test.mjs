/**
 * The inspection-job state machine, exercised without a database — the same way
 * order-states.test.mjs exercises the order machine. A machine you can test as data is a machine
 * whose rules are answerable by reading a table instead of tracing branches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATES, TERMINAL, canTransition, findTransition, transitionsFrom, isTerminal,
} from '../shared/inspection-states.mjs';

test('every transition names states that exist', () => {
  for (const t of transitionsFrom('posted').concat(
    STATES.flatMap((s) => transitionsFrom(s)))) {
    assert.ok(STATES.includes(t.from), `${t.from} is not a state`);
    assert.ok(STATES.includes(t.to), `${t.to} is not a state`);
  }
});

test('terminal states have no way out', () => {
  for (const s of TERMINAL) {
    assert.ok(isTerminal(s));
    assert.equal(transitionsFrom(s).length, 0, `${s} must be a dead end`);
    const r = canTransition(s, 'accepted', 'system');
    assert.ok(!r.ok);
    assert.equal(r.code, 'TERMINAL');
  }
});

test('an inspector claims a posted job; nobody else may', () => {
  assert.ok(canTransition('posted', 'claimed', 'inspector').ok);
  const wrong = canTransition('posted', 'claimed', 'commissioner');
  assert.ok(!wrong.ok);
  assert.equal(wrong.code, 'WRONG_ACTOR');
});

test('claiming binds the inspector — it goes through their mandate', () => {
  assert.equal(findTransition('posted', 'claimed').binds, true);
  // Nothing else binds: reporting facts needs authority to act, not authority to commit.
  assert.equal(findTransition('claimed', 'checked_in').binds, false);
  assert.equal(findTransition('checked_in', 'submitted').binds, false);
});

test('the commissioner accepts or rejects — never the inspector being paid', () => {
  assert.ok(canTransition('submitted', 'accepted', 'commissioner').ok);
  assert.ok(canTransition('submitted', 'rejected', 'commissioner').ok);
  assert.ok(!canTransition('submitted', 'accepted', 'inspector').ok);
});

test('a checked-in job cannot be un-checked-in', () => {
  // Discarding an inconvenient reading and retrying for a better one is the manufactured result
  // the capture step exists to prevent, so there is no path back.
  assert.equal(findTransition('checked_in', 'claimed'), null);
  assert.equal(findTransition('checked_in', 'posted'), null);
});

test('a rejection can be disputed, and only an arbiter resolves it', () => {
  assert.ok(canTransition('rejected', 'disputed', 'inspector').ok);
  assert.ok(canTransition('disputed', 'accepted', 'arbiter').ok);
  assert.ok(canTransition('disputed', 'rejected', 'arbiter').ok);
  assert.ok(!canTransition('disputed', 'accepted', 'commissioner').ok);
});

test('acceptance becomes a fee owed, by the system, and fee_due is terminal', () => {
  const t = findTransition('accepted', 'fee_due');
  assert.equal(t.actor, 'system');
  assert.ok(TERMINAL.includes('fee_due'));
});

test('unknown states are rejected with a stable code', () => {
  assert.equal(canTransition('nope', 'claimed', 'inspector').code, 'BAD_STATE');
  assert.equal(canTransition('posted', 'nope', 'inspector').code, 'BAD_STATE');
  assert.equal(canTransition('posted', 'accepted', 'inspector').code, 'NO_TRANSITION');
});
