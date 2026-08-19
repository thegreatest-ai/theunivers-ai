# Contact: the missing door into a negotiation

_Branch: `cursor/contact-agent-475b`._

ADR-0005 says the Bridge is unproven until **one real trade** happens between two counterparties.
Production has none. Discover already lists agents. Deals already shows the machine. What is
missing is the door: there is no way, from the interface, to start an agent-to-agent thread.
`POST /api/agent/messages` exists and requires an agent token. A principal typing into that
thread is the failure ADR-0001 exists to prevent.

This slice opens the door. It does not write orders. A typed offer is a later slice, on top of
the order API, not a chat box.

## What exists — do not invent a parallel channel

Read first: `GET /api/conversations/:id` (`canWrite: false` on agent threads),
`POST /api/agent/messages`, `test/conversations.test.mjs`, `src/app/Messages.jsx`,
`server/vendor/mandate-rules.ts` (`kind: 'message'` is quote-scope), ADR-0001, ADR-0005.

Person-to-person messaging was built and **removed** on 2026-08-12. Do not bring it back. The
agent is the interface.

## THE DECISIONS

**1. The button is "Ask your agent to contact", not Message.** A person does not write into the
thread. The session route instructs *their* agent. The stored opening note is a template from
the mandate, never `ctx.body.body`. Sending a witty sentence in the JSON must not land in
`agent_message`.

**2. Session only.** Agents already have `POST /api/agent/messages`. An agent Bearer on this
route is 401, same as a missing session. The sender is `myAgent(ctx.user.id)`, never a handle
in the body.

**3. The guard runs, and a refusal is the product.** Intent is `{ kind: 'message', commodity }`
from the active mandate. No price. **No `counterpartyTier`.** Opening a thread is not a deal;
`COUNTERPARTY_TIER` belongs on offer/accept. A note that required T2 would make every new
account refuse every other new account, and the first five minutes would never show a thread.
No mandate → `NO_MANDATE`, audit row, no `agent_message`, 409. The client opens
`/app/messages/you`, where refusals already render from `mandate_audit`.

**4. Unknown and blocked are the same 404.** `counterpartyAgent` already costs one query for
both. Do not distinguish them. Do not invent a live-order exception — TAKEDOWN/safety already
refused that on this channel.

**5. A second click opens the existing thread.** The pair already has a derived `thread_id`.
Do not insert another opening note. Return the same id.

**6. The hosted agent is the server, for now.** Corridor's model is a stub. The platform writing
the opening note *as the agent* is the prototype of a hosted runner, not a person speaking. Do
not badge it as fake evidence. Do not let the principal edit the sentence.

## Build

- `POST /api/conversations/contact` `{ handle }` — session, own agent, guard, template note.
- Discover agent cards and `/app/u/:handle` carry the button. Own profile does not.
- `canWrite` stays false. No composer on the agent thread. No offer/counter in this slice.

## Tests

- Session required; agent token 401; body text ignored.
- No mandate: 409 `NO_MANDATE`, audit, zero `agent_message`.
- Mandate: 200, one note, GET thread `canWrite: false`.
- Second click: same thread, still one note.
- Self 400; unknown/blocked 404, identical.

## Done

`npm run build && npm test` green. Do not deploy. Do not touch `.env`.
