/**
 * Agent handle rules. Shared by the browser and the server, so these protect the property that
 * matters most: the form and the API agreeing on what a handle is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkHandle, handleError, suggestHandle, MIN, MAX } from '../shared/agent-name.mjs';

test('accepts Instagram-style handles', () => {
  for (const h of ['alkhwarizmi.trading', 'musa_1', 'abc', 'a.b_c9', 'A1b2c3']) {
    assert.equal(handleError(h), null, `${h} should be valid`);
  }
});

test('rejects spaces — the most common mistake', () => {
  assert.match(handleError('Acme Trading'), /letters, numbers, dots and underscores/);
  assert.ok(handleError('acme trading'));
  assert.ok(handleError(' acme'));
});

test('rejects characters outside the allowed set', () => {
  for (const h of ['acme-trading', 'acme@x', 'acme/x', 'acme!', 'acmé']) {
    assert.ok(handleError(h), `${h} should be rejected`);
  }
});

test('enforces length bounds', () => {
  assert.ok(handleError('ab'), 'too short');
  assert.equal(handleError('abc'), null, `${MIN} is the minimum`);
  assert.equal(handleError('a'.repeat(MAX)), null, `${MAX} is allowed`);
  assert.ok(handleError('a'.repeat(MAX + 1)), 'over the maximum');
});

test('rejects handles that are confusable with another handle', () => {
  // Not style rules. "acme." and "acme" look identical in a list but are different rows, and this
  // product's whole claim is that you can tell who you are dealing with.
  for (const h of ['.acme', 'acme.', '_acme', 'acme_']) {
    assert.match(handleError(h), /start and end with a letter or number/, h);
  }
  for (const h of ['acme..trading', 'acme__trading', 'acme._trading']) {
    assert.match(handleError(h), /repeat a dot or underscore/, h);
  }
});

test('empty is rejected with its own message', () => {
  for (const v of ['', null, undefined]) assert.match(handleError(v), /required/);
});

test('checkHandle reports every rule, so the UI can show a checklist', () => {
  const { results, ok } = checkHandle('Acme Trading');
  assert.equal(ok, false);
  assert.ok(results.length >= 5);
  assert.equal(results.find((r) => r.id === 'charset').ok, false);
  assert.equal(results.find((r) => r.id === 'length').ok, true);
});

test('suggestHandle turns a company name into a usable handle', () => {
  assert.equal(suggestHandle('Alkhwarizmi Trading'), 'alkhwarizmi.trading');
  assert.equal(suggestHandle('Bhosale  Trading Co.'), 'bhosale.trading.co');
  assert.equal(suggestHandle('Café Münster'), 'cafe.munster');
  assert.equal(suggestHandle('--acme--'), 'acme');
});

test('every suggestion is itself a valid handle', () => {
  // A suggestion the gate would reject is worse than no suggestion.
  for (const t of ['Alkhwarizmi Trading', 'Bhosale  Trading Co.', 'Café Münster',
                   'A & B Traders', '  spaced  out  ', 'ACME!!!']) {
    const h = suggestHandle(t);
    if (h.length >= MIN) assert.equal(handleError(h), null, `${t} -> ${h}`);
  }
});
