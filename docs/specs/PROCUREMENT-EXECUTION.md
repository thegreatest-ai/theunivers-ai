# Procurement execution: the buyer feels they have an employee

_Proposed direction, not an ADR. Second-engineer seat._

The owner’s business brief, received 2026-08-18, in one sentence:

> **Ask. Source. Compare. Buy.** The product is a procurement employee, not a search engine.

A buyer types what they need. The system finds suppliers, qualifies them, requests quotations,
extracts the answers into one table, and recommends. The buyer approves. They should not need
procurement vocabulary.

This is **not** a silent replacement of `ADR-0005`, and it is not a V1 choice for this repo.
ADR-0005 says the Bridge is the product. The owner’s correction (2026-08-18): the procurement
plan is a **different product**. The individual in that world is a procurement manager, not a
person with a profile. The brief’s §20 — buyer agent negotiating with supplier agents under
mandate — is the machinery already here. Do not build the agent layer twice.

## North star

**Successful sourcing requests** — the buyer received at least three comparable, qualified
quotations. Not registered users, not messages, not “suppliers found”.

## THE DECISIONS (already made in the brief, recorded so they are not re-litigated in code)

**1. One orchestrator, not five products.** Discovery, qualification, RFQ, extraction and
recommendation are *jobs*. They may look like agents in the interface. Technically they are tools
the orchestrator calls. Section 5 of the brief already says this. A second orchestration framework
alongside `server/guard.mjs` would be the mandate-rules drift all over again.

**2. The human approves anything that binds.** The AI may find, contact, request quotes, ask
technical questions, follow up. It may not negotiate price, commit volume, accept terms, issue a
PO, or pay, until a person says so. That is ADR-0001 in buyer clothes: text is not authority.

**3. Suppliers do not have to register.** A sourcing event gets an inbox address. They reply by
email (WhatsApp later). Forcing a supplier account is how the other side of the marketplace stays
empty.

**4. The supplier database is the moat.** Every search that finds “ABC Organic Foods LLC” saves
it. The next tomato request is better. Price, MOQ, delivery, certification, response rate accumulate.
That graph is harder to copy than the UI. It is also **derived from what happened**, never a badge
somebody set — same shape as tier.

**5. UAE first, small buyers first.** Restaurant, café, small hotel, office, subcontractor. Not
Emirates. Categories: food, ordinary business supplies, ordinary services. Not highly regulated
goods. GCC after UAE, global after GCC.

**6. Charge buyers, not suppliers, and not a success fee yet.** Free / Pro / Business / Enterprise
is a pricing experiment, not a schema. Do not build billing in V1.

**7. Keep this repo’s stack for V1.** The brief suggests Next.js, FastAPI, Supabase, Vercel. This
codebase is one Node process, SQLite, Fly, one origin, CSP with no product-page external hosts.
Switching stacks to start is how you get two products again. External search, mail, and WhatsApp
are reached from the **server** (see `server/geocode.mjs`, `server/mail.mjs`), never from the page.

**8. Do not negotiate in V1.** Recommend; the human presses Send. Semi-autonomous then autonomous
inside a mandate is Phase 2+, and it is exactly what the Bridge already refuses to do without a
guard.

## V1 user journey (the only thing that has to work)

Buyer types:

> I need 500 kg/week of certified organic tomatoes delivered to Dubai. UAE or Oman suppliers
> preferred. Target below AED 12/kg.

The system turns that into a structured request (product, quantity, frequency, place, ceiling,
certification, origin). Missing fields are questions in ordinary language, not a form labelled
MOQ and Incoterms.

Then, in order, and with the buyer able to see each step:

Request → Search → Qualify → Contact → RFQ → Quotations in → Extract → Compare → Recommend

Done means: three comparable quotes and a recommendation that is **explained**. “Green Farms, not
the lowest unit price, because payment terms, delivery and MOQ” — a score that cannot be explained
cannot be appealed. Same rule as the feed.

A Match score is a **fit** to this request, not a trust tier. Do not call it trust, and do not
write it onto the supplier as standing. Standing stays derived from anchors and receipts.

## What already exists here (do not rebuild)

| This brief | Already in the repo |
|---|---|
| Sentence → structured need | `POST /api/mandate/draft` (ADR-0004) — draft, a person confirms |
| Ceiling / “do not go below” | mandate floor/ceiling, enforced only at bind |
| Human approval | proposals; guard on `accept` |
| Record of what happened | receipts, hash-chained, per principal |
| “Who is this counterparty” | anchors, derived tier — **not** a Match score |
| Agent talks to agent | `agent_message`, long-term §20 |
| Mail leaving the server | Resend, `server/mail.mjs` |

What does **not** exist: web supplier discovery, a supplier table, RFQ send/inbox, PDF/Excel
quote extraction, a comparison table, a Match score, WhatsApp.

## What to build first, if this direction is accepted

Days 1–15 of the brief, mapped onto *this* process, not a new app:

1. A request object (not a mandate — a mandate is authority; a request is a sourcing job).
2. Orchestrator chat that fills the request by asking, then stops for confirmation.
3. Discovery that searches from the **server**, writes supplier rows, and shows them as claims
   (“found on this page, on this date”), never as verified standing.
4. The buyer sees counts that are derived: found, qualified, contacted, responded, shortlisted.

Do not start RFQ email until a buyer has looked at a list of suppliers and said “these”. An RFQ
sent to a hallucinated address is invented evidence wearing a letterhead.

## What not to build (V1)

From the brief, and from this repo’s own scars:

- inventory, ERP, accounting, WMS, payments, contracts, full PO workflow, blockchain, supplier
  marketplace, native apps, twenty agents
- a second mandate guard, a second receipt chain, a trust column someone can set
- Next.js + FastAPI + Supabase as a parallel product
- WhatsApp before email works
- negotiation
- charging suppliers
- “Verified” on a company the platform has not checked
- optimistic quotes, invented counts, a success toast for a mail that did not send

## This is a different product

Settled 2026-08-18 by the owner, in those words: **a different product to this one.** There is no
individual side to it. The person in that world is a procurement manager doing their job, not a
person with a profile.

This repo is the four viewpoints in `docs/specs/PREMIUM-SOCIAL-V1.md`:

- A. End user — browsing, hiring, trusting
- B. Individual — profile, works, citations, one agent, an appeal path that is not shadowban theatre
- C. Business owner — mandates, orders, receipts
- D. Agents — HTTP skill, cannot widen a mandate through chat

The overlap is only the endgame in the procurement brief’s §20: buyer agent and supplier agent
under mandate, human approval before commitment. That machinery already lives here. **Do not build
the agent layer twice.**

Do not start a discovery crawler, an RFQ inbox, or a second stack in this repository. If procurement
is built, it is another product that *calls* this one at the bind, the same way Corridor’s rules
are vendored rather than rewritten.
