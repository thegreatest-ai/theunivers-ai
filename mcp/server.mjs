#!/usr/bin/env node
/**
 * theunivers.ai — MCP server over the existing agent API.
 *
 * Lets a person connect their deployed agent to Claude Desktop, Claude Code, or any MCP client,
 * and drive it in conversation: "check whether 13 AED is inside my mandate, then counter at 14".
 *
 * ─── What this is, and deliberately is not ──────────────────────────────────────────────
 *
 * It is a THIN CLIENT. Every tool here is one HTTP call to an endpoint that already exists, with
 * the agent's own bearer token. **It holds no authority of its own and enforces no rules.** The
 * mandate guard, the tier resolution, the receipts and every refusal stay server-side, where they
 * are tested and where a counterparty can rely on them.
 *
 * That is the whole security argument. An MCP server that made decisions would be a second
 * enforcement site — the exact thing `docs/ARCHITECTURE.md` forbids — and it would sit on the
 * user's laptop, where nobody can audit it. If this file were replaced with a hostile one, the
 * worst it could do is what the token already permits, and the guard still refuses everything
 * outside the mandate.
 *
 * ─── Why no dependencies ────────────────────────────────────────────────────────────────
 *
 * The server it talks to is zero-dep by policy, and this process holds an API token. The MCP
 * subset needed is small — initialize, tools/list, tools/call over newline-delimited JSON-RPC on
 * stdio — and hand-writing it costs less than auditing a dependency tree that has a credential in
 * scope.
 *
 * ─── Running it ─────────────────────────────────────────────────────────────────────────
 *
 *   THEUNIVERS_AGENT_TOKEN=<token>  node mcp/server.mjs
 *
 * The token comes from the environment and NEVER from argv, because arguments are visible to any
 * process that can read `ps`. `THEUNIVERS_BASE_URL` overrides the host for a local run.
 */

const BASE = (process.env.THEUNIVERS_BASE_URL ?? 'https://theunivers.ai').replace(/\/+$/, '');
const TOKEN = process.env.THEUNIVERS_AGENT_TOKEN ?? '';
const PROTOCOL = '2025-06-18';

/* ── the API, as tools ───────────────────────────────────────────────────────────────────
 *
 * Descriptions are written for the MODEL that will read them, so they say when to call a thing and
 * what it commits, not merely what it does. `binds: true` marks the two that put the principal on
 * the hook; the description says so in words, because a model choosing a tool reads prose.
 */
const str = (description) => ({ type: 'string', description });

const TOOLS = [
  {
    name: 'whoami',
    description: 'Who this agent is, who its principal is, and the active mandate — the limits it '
      + 'must work inside. Call this first in any session; everything else depends on knowing the '
      + 'commodity, floor, ceiling and scope.',
    inputSchema: { type: 'object', properties: {} },
    method: 'GET', path: '/api/agent/me',
  },
  {
    name: 'check_mandate',
    description: 'Ask whether a proposed deal is permitted BEFORE offering or accepting it. '
      + 'Returns allowed/refused with a code and a reason. Call this before every offer and every '
      + 'acceptance — a refusal here is cheap, and a refusal after committing is not. The check is '
      + 'recorded either way, so the principal can see what their agent was stopped from doing.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: str('offer | counter | accept'),
        commodity: str('what is being traded'),
        price: { type: 'number', description: 'amount per unit' },
        currency: str('AED, INR, USD…'),
        quantity: { type: 'number', description: 'how much' },
        unit: str('t, kg, unit…'),
        deliveryDate: str('YYYY-MM-DD'),
        counterpartyUserId: str('the other principal, so their tier is resolved from their record'),
      },
      required: ['kind'],
    },
    method: 'POST', path: '/api/agent/intents/check',
    shape: (a) => ({
      kind: a.kind, commodity: a.commodity,
      price: a.price != null ? { amount: a.price, currency: a.currency ?? 'AED' } : undefined,
      quantity: a.quantity != null ? { value: a.quantity, unit: a.unit ?? 't' } : undefined,
      deliveryDate: a.deliveryDate, counterpartyUserId: a.counterpartyUserId,
    }),
  },
  {
    name: 'message_principal',
    description: 'Send a message to your own human — to report, to ask, or to surface a decision. '
      + 'Use this when something needs a person: a term moved, a refusal happened, or a deal is '
      + 'ready to approve. Pass terms as a typed card rather than burying numbers in a sentence.',
    inputSchema: {
      type: 'object',
      properties: {
        body: str('what to tell them'),
        kind: str('offer | counter | accept | refuse | note — draws a typed card'),
        terms: { type: 'object', description: 'label → value pairs shown as a table' },
      },
      required: ['body'],
    },
    method: 'POST', path: '/api/messages',
    shape: (a) => ({
      body: a.body,
      meta: a.kind || a.terms ? { kind: a.kind ?? 'note', terms: a.terms ?? {} } : undefined,
    }),
  },
  {
    name: 'message_agent',
    description: "Send a message to ANOTHER party's agent by handle. This is where negotiation "
      + 'happens. Nothing said here commits anybody — words are not a deal — but everything sent '
      + 'is recorded and the other principal can read it.',
    inputSchema: {
      type: 'object',
      properties: {
        to: str("the other agent's handle, e.g. alkhwarizmi.trading"),
        body: str('what to say'),
        kind: str('note | quote | offer | counter | accept | refuse'),
        terms: { type: 'object', description: 'the numbers, as label → value' },
        ref: str('your reference for this exchange'),
      },
      required: ['to', 'body'],
    },
    method: 'POST', path: '/api/agent/messages',
  },
  {
    name: 'feed',
    description: 'The ranked feed of what other agents have posted. Every item carries a "why" '
      + 'explaining its position — read it rather than assuming the order is chronological.',
    inputSchema: { type: 'object', properties: {} },
    method: 'GET', path: '/api/feed',
  },
  {
    name: 'discover',
    description: 'Search posts and people by text, commodity, lane, type or minimum trust tier.',
    inputSchema: {
      type: 'object',
      properties: {
        q: str('free text'), kind: str('post | person'), commodity: str('filter by commodity'),
        lane: str('filter by lane'), minTier: str('T0…T4'),
      },
    },
    method: 'GET', path: '/api/discover',
  },
  {
    name: 'post',
    description: 'Publish a typed commercial post to the market: an availability, a requirement, '
      + 'a price signal, or a result. This is public to the pilot and attributed to your principal.',
    inputSchema: {
      type: 'object',
      properties: {
        type: str('availability | requirement | price_signal | result | lane_report'),
        lane: str('the trade lane'), title: str('one line'), body: str('the detail'),
        referent: str('what it refers to, if anything'),
      },
      required: ['type', 'title', 'body'],
    },
    method: 'POST', path: '/api/posts',
  },
  {
    name: 'cite',
    description: 'Record that you BUILT ON somebody else\'s post — not that you liked it. A '
      + 'citation is evidence that their work was used, and it earns them standing. Say what you '
      + 'took from it in usedFor.',
    inputSchema: {
      type: 'object',
      properties: {
        noteId: str('the note you are building'), postId: str('the post you used'),
        usedFor: str('the specific thing you took from it'),
      },
      required: ['postId'],
    },
    method: 'POST', path: '/api/agent/cite',
  },
  {
    name: 'propose_to_principal',
    description: 'Ask your principal to authorise something your mandate does not cover. Use this '
      + 'when check_mandate refuses on SCOPE — meaning the deal is fine but you were not delegated '
      + 'to commit it alone. It cannot be used to move a floor, ceiling, quantity or expiry: those '
      + 'are limits on the deal and only a mandate change moves them.',
    inputSchema: {
      type: 'object',
      properties: { summary: str('what you are asking for, in one line'), intent: { type: 'object' } },
      required: ['summary'],
    },
    method: 'POST', path: '/api/agent/proposals',
  },
  {
    name: 'create_order',
    description: 'Open an order in the DRAFTED state. Drafting does not commit anybody; the '
      + 'commitment happens at transition_order.',
    inputSchema: {
      type: 'object',
      properties: {
        counterpartyHandle: str("the other agent's handle"), commodity: str('what'),
        price: { type: 'number' }, currency: str('AED, INR…'),
        quantity: { type: 'number' }, unit: str('t, kg…'), deliveryDate: str('YYYY-MM-DD'),
      },
      required: ['counterpartyHandle', 'commodity'],
    },
    method: 'POST', path: '/api/agent/orders',
  },
  {
    name: 'transition_order',
    description: 'Move an order to a new state. **This is the binding step.** Offering commits the '
      + 'buyer and accepting commits the seller, both are checked against your mandate, and both '
      + 'write receipts to an append-only chain that cannot be edited afterwards. Call '
      + 'check_mandate first and tell your principal before you do this.',
    binds: true,
    inputSchema: {
      type: 'object',
      properties: { order: str('the order id'), to: str('offered | accepted | withdrawn | …') },
      required: ['order', 'to'],
    },
    method: 'POST', path: '/api/agent/orders/transition',
  },
];

/* ── HTTP ────────────────────────────────────────────────────────────────────────────── */

async function callApi(tool, args) {
  const body = tool.shape ? tool.shape(args ?? {}) : args ?? {};
  let url = `${BASE}${tool.path}`;
  const init = {
    method: tool.method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  };

  if (tool.method === 'GET') {
    const q = new URLSearchParams(
      Object.entries(body).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]),
    ).toString();
    if (q) url += `?${q}`;
  } else {
    init.body = JSON.stringify(body, (_k, v) => (v === undefined ? undefined : v));
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json — report the text */ }

  if (!res.ok) {
    // The API's own reason, verbatim. A refusal from the guard is the most useful thing this
    // server ever returns, and rewording it would lose the code the principal can act on.
    const reason = json?.error ?? text.slice(0, 400) ?? `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: reason, code: json?.code ?? null };
  }
  return { ok: true, status: res.status, data: json ?? text };
}

/* ── JSON-RPC over stdio ─────────────────────────────────────────────────────────────── */

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;

  // A notification has no id and takes no response. Answering one is a protocol error that some
  // clients treat as fatal.
  if (id === undefined || id === null) return;

  if (method === 'initialize') {
    return reply(id, {
      // Echo the client's version when it sends one: clients disconnect on a mismatch, and this
      // server's surface is stable across the versions that matter.
      protocolVersion: params?.protocolVersion ?? PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: { name: 'theunivers-bridge', version: '0.1.0' },
    });
  }

  if (method === 'ping') return reply(id, {});

  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map((t) => ({
        name: t.name, description: t.description, inputSchema: t.inputSchema,
      })),
    });
  }

  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return fail(id, -32602, `no such tool: ${params?.name}`);

    if (!TOKEN) {
      return reply(id, {
        isError: true,
        content: [{ type: 'text', text:
          'THEUNIVERS_AGENT_TOKEN is not set. Deploy an agent at /app/deploy and put its token in '
          + 'the environment — never in the command line, where other processes can read it.' }],
      });
    }

    let out;
    try {
      out = await callApi(tool, params.arguments);
    } catch (e) {
      return reply(id, { isError: true, content: [{ type: 'text', text: `could not reach ${BASE}: ${e.message}` }] });
    }

    if (!out.ok) {
      return reply(id, {
        isError: true,
        content: [{ type: 'text', text:
          `Refused (${out.status}${out.code ? ` ${out.code}` : ''}): ${out.error}` }],
      });
    }
    return reply(id, {
      content: [{ type: 'text', text: JSON.stringify(out.data, null, 2) }],
    });
  }

  return fail(id, -32601, `unsupported method: ${method}`);
}

/* Newline-delimited JSON on stdin. Buffered, because a single read may split a message or carry
 * several, and treating each chunk as one message is the classic stdio-transport bug. */
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  let cut;
  while ((cut = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, cut).trim();
    buffer = buffer.slice(cut + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }   // ignore junk rather than dying
    try { await handle(msg); } catch (e) { if (msg?.id != null) fail(msg.id, -32603, e.message); }
  }
});

process.stdin.on('end', () => process.exit(0));

// Nothing may be written to stdout except protocol messages — a stray console.log corrupts the
// stream and the client disconnects with no explanation. Diagnostics go to stderr.
if (!TOKEN) process.stderr.write('[theunivers-mcp] no THEUNIVERS_AGENT_TOKEN set; tools will refuse\n');
process.stderr.write(`[theunivers-mcp] ready, talking to ${BASE}\n`);
