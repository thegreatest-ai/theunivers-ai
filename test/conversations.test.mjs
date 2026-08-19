/**
 * WHO MAY SAY WHAT, and where it is written down.
 *
 * Messages is the surface where ADR-0001 is either honoured or quietly lost. The rules it depends
 * on are structural, so they can be checked structurally:
 *
 *   · a counterparty's agent is written to `agent_message`, never to `message`. `message.from_role`
 *     is a CHECK over user | agent | system where `agent` means the one THIS principal deployed;
 *     one more row in there and "who said this" becomes a guess.
 *   · the sender comes from the token. Read from the body, a counterparty could speak as your agent.
 *   · a principal cannot type into an agent-to-agent thread. Authority moves through /api/mandate,
 *     which is recorded; a sentence in a conversation is not.
 *   · a refusal shown to a principal comes from `mandate_audit` — what the guard decided — and not
 *     from anything an agent said about itself.
 *
 * Read from the source rather than over HTTP, like who-may.test.mjs, so the suite stays
 * dependency-free and cannot pass because a server happened to be running.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'server', 'index.mjs'), 'utf8');
const DB = readFileSync(join(ROOT, 'server', 'db.mjs'), 'utf8');

function routeBody(method, path) {
  const start = SERVER.indexOf(`route('${method}', '${path}'`);
  assert.notEqual(start, -1, `${method} ${path} is not registered`);
  const next = SERVER.indexOf("\nroute('", start + 1);
  return SERVER.slice(start, next === -1 ? SERVER.length : next);
}

test('an agent-to-agent message is a different table from you-to-your-agent', () => {
  assert.match(DB, /CREATE TABLE IF NOT EXISTS agent_message/,
    'agent_message must exist — a counterparty cannot share a table with your own agent');
  const body = routeBody('POST', '/api/agent/messages');
  assert.match(body, /INSERT INTO agent_message/);
  assert.doesNotMatch(body, /INSERT INTO message\b/,
    'writing a counterparty into `message` would make from_role mean two different things');
});

test('the sender is the token, never the body', () => {
  const body = routeBody('POST', '/api/agent/messages');
  assert.match(body, /const agent = ctx\.agent;\s*\n\s*if \(!agent\) return err\(401/,
    'an agent token is required to speak as an agent');
  assert.doesNotMatch(body, /ctx\.body\.from|ctx\.body\.fromAgent/,
    'a sender read from the body lets a counterparty speak as somebody else');
});

test('an agent cannot address itself, at the schema as well as the route', () => {
  assert.match(DB, /CHECK \(from_agent_id <> to_agent_id\)/,
    'the database must refuse a self-addressed thread, not only the route');
  assert.match(routeBody('POST', '/api/agent/messages'), /cannot message itself/);
});

test('a principal reads an agent-to-agent thread and cannot write into it', () => {
  const body = routeBody('GET', '/api/conversations/:id');
  // `canWrite: true` for the principal's own thread, false for the other kind. Both appear; what
  // matters is that the agent branch is the false one.
  const agentBranch = body.slice(body.indexOf('agent_message'));
  assert.match(agentBranch, /canWrite: false/,
    'a person typing into a negotiation between two mandated agents is authority with no record');
});

test('contact is a session instructing YOUR agent, never a sentence in the thread', () => {
  const body = routeBody('POST', '/api/conversations/contact');
  assert.match(body, /if \(!ctx\.user\) return err\(401/,
    'a session is required — agents already have POST /api/agent/messages');
  assert.match(body, /myAgent\(ctx\.user\.id\)/,
    'the sender is the principal’s agent, not a handle in the body');
  assert.doesNotMatch(body, /ctx\.body\.body/,
    'a witty sentence in the JSON must not land in agent_message');
  assert.match(body, /kind: 'message'/,
    'the guard sees a message intent, quote-scope, not an offer');
  assert.doesNotMatch(body, /resolveTier\(/,
    'opening a thread is not a deal — standing binds when terms are offered');
  assert.doesNotMatch(body, /counterpartyTier:/,
    'do not put a resolved tier on a note');
});

test('thread membership is derived from the rows, not trusted from the id', () => {
  const body = routeBody('GET', '/api/conversations/:id');
  assert.match(body, /from_agent_id === agent\.id \|\| r\.to_agent_id === agent\.id/,
    'a guessed thread_id must return nothing rather than somebody else’s negotiation');
  assert.match(body, /mine\.length !== rows\.length/,
    'a thread containing any row this agent is not party to must not be served');
});

test('the counterparty tier is resolved, never taken from the conversation', () => {
  const list = routeBody('GET', '/api/conversations');
  assert.match(list, /resolveTier\(other\.user_id\)/,
    'standing is derived from the counterparty’s anchors, never asserted by them');
});

test('a refusal shown to the principal comes from the guard, not from the agent', () => {
  const refusals = SERVER.slice(SERVER.indexOf('function refusalItems'));
  assert.match(refusals.slice(0, 400), /FROM mandate_audit WHERE agent_id = \? AND allowed = 0/,
    'refusals must be read from the audit the guard wrote');
});
