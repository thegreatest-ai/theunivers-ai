/**
 * The password policy is imported by BOTH the browser and the server, so these tests protect the
 * one thing that must never drift: the form and the API agreeing on what is acceptable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, checkPassword, passwordError } from '../shared/password-policy.mjs';

test('accepts a password meeting every rule', () => {
  assert.equal(passwordError('Str0ng!pass'), null);
  assert.equal(checkPassword('Str0ng!pass').ok, true);
});

test('names every rule that failed, not just the first', () => {
  const msg = passwordError('abc12345');           // missing capital and symbol
  assert.match(msg, /capital letter/);
  assert.match(msg, /symbol/);
  assert.doesNotMatch(msg, /8 characters/, 'must not report rules that passed');
});

test('the message does not mangle what is inside a label', () => {
  // Regression: lowercasing the whole label turned "(A–Z)" into "(a–z)", so the sentence asked
  // for a capital letter and illustrated it with a lowercase range.
  const msg = passwordError('abc12345');
  assert.match(msg, /\(A–Z\)/, 'the range must stay uppercase');
  assert.doesNotMatch(msg, /\(a–z\)/);
  assert.match(msg, /needs: one capital/, 'and still read naturally mid-sentence');
});

test('each rule is enforced individually', () => {
  const cases = {
    length: 'Ab1!xy',            // 6 chars
    upper:  'abc12345!',
    number: 'Abcdefg!',
    symbol: 'Abcd1234',
  };
  for (const [id, pw] of Object.entries(cases)) {
    const failed = checkPassword(pw).results.filter((r) => !r.ok).map((r) => r.id);
    assert.deepEqual(failed, [id], `${pw} should fail exactly ${id}`);
  }
});

test('checkPassword returns a result for every rule, in order', () => {
  const { results } = checkPassword('x');
  assert.equal(results.length, RULES.length);
  assert.deepEqual(results.map((r) => r.id), RULES.map((r) => r.id));
});

test('null and undefined are handled, not thrown on', () => {
  for (const v of [null, undefined, '', 0]) {
    assert.equal(checkPassword(v).ok, false);
    assert.ok(passwordError(v));
  }
});
