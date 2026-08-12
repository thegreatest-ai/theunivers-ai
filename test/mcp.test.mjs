/**
 * The MCP server, driven the way a client drives it: a real child process, newline-delimited
 * JSON-RPC on stdio, answering against a stub of the API.
 *
 * Tested end-to-end rather than by importing functions, because the failures that matter in a
 * stdio transport are transport failures — a message split across two reads, two messages in one
 * read, a notification answered when it should be ignored, or anything at all written to stdout
 * that is not protocol. None of those are visible to a unit test, and every one of them presents
 * to the user as "the server disconnected" with no explanation.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let api;            // the stub API
let apiPort;
let calls = [];     // what the MCP server asked it for
let child;
let pending = new Map();
let stdoutSeen = '';

/** The stub answers anything with a recognisable body, and records the request. */
function startStub() {
  return new Promise((resolve) => {
    api = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        calls.push({
          method: req.method,
          url: req.url,
          auth: req.headers.authorization ?? null,
          body: body ? JSON.parse(body) : null,
        });
        if (req.url.startsWith('/api/agent/orders/transition')) {
          res.writeHead(409, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Refused by your mandate: below floor', code: 'FLOOR' }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saw: req.url }));
      });
    });
    api.listen(0, '127.0.0.1', () => resolve(api.address().port));
  });
}

/** Send a JSON-RPC request and wait for the matching id. */
function rpc(msg, { expectReply = true } = {}) {
  const line = `${JSON.stringify(msg)}\n`;
  if (!expectReply) { child.stdin.write(line); return Promise.resolve(null); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reply to ${msg.method}`)), 10_000);
    pending.set(msg.id, (r) => { clearTimeout(timer); resolve(r); });
    child.stdin.write(line);
  });
}

before(async () => {
  apiPort = await startStub();
  child = spawn(process.execPath, [join(ROOT, 'mcp', 'server.mjs')], {
    env: {
      ...process.env,
      THEUNIVERS_BASE_URL: `http://127.0.0.1:${apiPort}`,
      THEUNIVERS_AGENT_TOKEN: 'tok_agent_test',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutSeen += chunk;
    buf += chunk;
    let cut;
    while ((cut = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, cut).trim();
      buf = buf.slice(cut + 1);
      if (!line) continue;
      const msg = JSON.parse(line);          // must ALWAYS be valid JSON; that is the contract
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
});

after(() => { child?.kill(); api?.close(); });

describe('the handshake', () => {
  test('initialize answers with capabilities and echoes the protocol version', async () => {
    const r = await rpc({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    assert.equal(r.result.protocolVersion, '2025-06-18', 'a mismatch makes clients disconnect');
    assert.ok(r.result.capabilities.tools, 'must advertise tools');
    assert.equal(r.result.serverInfo.name, 'theunivers-bridge');
  });

  test('a notification gets NO reply — answering one is a protocol error', async () => {
    await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { expectReply: false });
    // If it wrongly replied, the next request's id would collide with a stray message; prove the
    // stream is still clean by round-tripping a ping.
    const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'ping' });
    assert.deepEqual(r.result, {});
  });
});

describe('the tools', () => {
  test('tools/list returns every tool with a description and a schema', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const tools = r.result.tools;
    assert.ok(tools.length >= 10, `expected the full surface, got ${tools.length}`);
    for (const t of tools) {
      assert.ok(t.name, 'every tool needs a name');
      assert.ok(t.description?.length > 30, `${t.name} needs a description a model can act on`);
      assert.equal(t.inputSchema.type, 'object');
    }
    const names = tools.map((t) => t.name);
    for (const required of ['whoami', 'check_mandate', 'message_principal', 'message_agent', 'transition_order']) {
      assert.ok(names.includes(required), `missing ${required}`);
    }
  });

  test('the binding tool SAYS it binds, because a model choosing it reads prose', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    const t = r.result.tools.find((x) => x.name === 'transition_order');
    assert.match(t.description, /binding step/i);
    assert.match(t.description, /receipts/i);
  });

  test('an internal field never leaks into the advertised schema', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    for (const t of r.result.tools) {
      assert.equal(t.method, undefined, 'the HTTP method is ours, not the client\'s business');
      assert.equal(t.path, undefined);
      assert.equal(t.shape, undefined);
    }
  });
});

describe('calling through to the API', () => {
  test('a GET tool sends the bearer token and hits the right path', async () => {
    calls = [];
    const r = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'whoami', arguments: {} } });
    assert.equal(r.result.isError, undefined);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].url, '/api/agent/me');
    assert.equal(calls[0].auth, 'Bearer tok_agent_test');
  });

  test('check_mandate reshapes flat arguments into the API\'s nested shape', async () => {
    calls = [];
    await rpc({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'check_mandate', arguments: { kind: 'offer', commodity: 'red onion', price: 13, currency: 'AED', quantity: 40, unit: 't' } },
    });
    assert.deepEqual(calls[0].body.price, { amount: 13, currency: 'AED' },
      'a model should not have to know the wire shape');
    assert.deepEqual(calls[0].body.quantity, { value: 40, unit: 't' });
  });

  test('a refusal from the guard is passed through with its code, not reworded', async () => {
    const r = await rpc({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'transition_order', arguments: { order: 'ord_1', to: 'accepted' } },
    });
    assert.equal(r.result.isError, true);
    const text = r.result.content[0].text;
    assert.match(text, /FLOOR/, 'the code is the thing the principal can act on');
    assert.match(text, /below floor/);
  });

  test('an unknown tool is a protocol error, not a silent success', async () => {
    const r = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'delete_everything' } });
    assert.ok(r.error, 'must not pretend to have done something');
    assert.equal(r.error.code, -32602);
  });

  test('query arguments become a query string, and empties are dropped', async () => {
    calls = [];
    await rpc({
      jsonrpc: '2.0', id: 10, method: 'tools/call',
      params: { name: 'discover', arguments: { q: 'onion', lane: '', minTier: 'T2' } },
    });
    assert.match(calls[0].url, /^\/api\/discover\?/);
    assert.match(calls[0].url, /q=onion/);
    assert.match(calls[0].url, /minTier=T2/);
    assert.ok(!calls[0].url.includes('lane='), 'an empty filter is not a filter');
  });
});

describe('the transport itself', () => {
  test('two messages in one write are both handled', async () => {
    const a = new Promise((res) => pending.set(20, res));
    const b = new Promise((res) => pending.set(21, res));
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 20, method: 'ping' })}\n`
      + `${JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'ping' })}\n`);
    assert.equal((await a).id, 20);
    assert.equal((await b).id, 21);
  });

  test('a message split across two writes is reassembled', async () => {
    const whole = JSON.stringify({ jsonrpc: '2.0', id: 22, method: 'ping' });
    const done = new Promise((res) => pending.set(22, res));
    child.stdin.write(whole.slice(0, 12));
    await new Promise((r) => setTimeout(r, 40));
    child.stdin.write(`${whole.slice(12)}\n`);
    assert.equal((await done).id, 22);
  });

  test('junk on the line is ignored rather than killing the server', async () => {
    child.stdin.write('this is not json\n');
    const r = await rpc({ jsonrpc: '2.0', id: 23, method: 'ping' });
    assert.deepEqual(r.result, {}, 'the server must survive a bad line');
  });

  test('NOTHING but protocol has been written to stdout', () => {
    for (const line of stdoutSeen.split('\n').filter(Boolean)) {
      assert.doesNotThrow(() => JSON.parse(line),
        `stdout must carry only JSON-RPC — a stray log corrupts the stream: ${line.slice(0, 80)}`);
    }
  });
});
