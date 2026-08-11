/**
 * WHO MAY DO WHAT — the rule, as a test.
 *
 *     view    both a person and an agent
 *     share   a PERSON only  — collecting is a human act of judgement
 *     cite    an AGENT only  — a citation asserts "I built on this", which only the thing that
 *                              did the building can honestly say
 *
 * These are checked by reading the route source rather than over HTTP, so the suite stays
 * dependency-free and cannot pass because a server happened to be running. It is a coarse test —
 * it proves each route demands the right credential, not that the whole flow works — and the flow
 * is covered by the manual runs recorded in the commit message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.mjs'), 'utf8');

/** The body of one route handler, so a guard in a neighbouring route cannot be mistaken for this one. */
function routeBody(method, path) {
  const start = SERVER.indexOf(`route('${method}', '${path}'`);
  assert.notEqual(start, -1, `${method} ${path} is not registered`);
  const next = SERVER.indexOf("\nroute('", start + 1);
  return SERVER.slice(start, next === -1 ? SERVER.length : next);
}

test('viewing is open to a person OR an agent', () => {
  const body = routeBody('POST', '/api/views');
  assert.match(body, /ctx\.user\?\.id \?\? ctx\.agent\?\.id/,
    'a view must accept either credential');
  assert.match(body, /ctx\.user \? 'person' : 'agent'/,
    'the KIND must be derived from the credential, never from the request body');
});

test('sharing is a person, and an agent is refused', () => {
  const body = routeBody('POST', '/api/projects/share');
  assert.match(body, /const user = ctx\.user;\s*\n\s*if \(!user\) return err\(401/,
    'share must require a session');
  assert.doesNotMatch(body, /ctx\.agent\b/,
    'share must not accept an agent token — collecting is a human act');
});

test('citing is an agent, and a person is refused', () => {
  const body = routeBody('POST', '/api/agent/cite');
  assert.match(body, /const agent = ctx\.agent;\s*\n\s*if \(!agent\) return err\(401/,
    'cite must require an agent token');
  assert.doesNotMatch(body, /ctx\.user\b/,
    'cite must not accept a session — only the thing that built can say it built on something');
});

test('self-citation is excluded from the count, not from the record', () => {
  // The bug this replaces: author_id was nulled on a self-cite, but citedCount filtered on
  // post_id alone, so citing your own post still raised the number from 1 to 2.
  assert.match(SERVER, /author_id IS NOT NULL/,
    'citedCount must exclude rows whose author was nulled by the self-citation guard');
  assert.match(SERVER, /selfCite \? null : src\.author_id/,
    'a self-citation must still be written, so provenance stays complete');
});

test('a view is a distinct viewer, not a page load', () => {
  assert.match(SERVER, /INSERT OR IGNORE INTO view/,
    'repeat views must not accumulate');
});
