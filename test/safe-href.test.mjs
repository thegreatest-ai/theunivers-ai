/**
 * Profile and citation links. The glass renders these as <a href>. A scheme that is a program
 * must never come back as a string the renderer can put in the attribute.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWebAddress, safeHref } from '../shared/safe-href.mjs';

test('https and http addresses pass', () => {
  assert.equal(safeHref('https://example.test/x'), 'https://example.test/x');
  assert.equal(safeHref('http://localhost:8790/app'), 'http://localhost:8790/app');
  assert.equal(isWebAddress('HTTPS://Example.TEST'), true);
});

test('javascript:, data:, vbscript: and schemeless values are null, not escaped', () => {
  for (const u of [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    '/relative',
    'example.test',
    '',
    null,
    undefined,
  ]) {
    assert.equal(safeHref(u), null, String(u));
    assert.equal(isWebAddress(u), false, String(u));
  }
});

test('leading space does not smuggle a scheme past the check', () => {
  assert.equal(safeHref('  javascript:alert(1)'), null);
  assert.equal(safeHref('  https://example.test'), 'https://example.test');
});
