# ADR-0004 — A mandate may be drafted from a sentence, and confirmed only by a person

**Status:** accepted · 2026-08-12
**Context:** the owner asked for the mandate to be removed, so that a principal could say "1, 2, 3"
and the agent would do the whole job — the way they already work with the Team Room.

---

## Decision

**The mandate stays. The form goes.**

A principal writes what they want in their own words. A model reads it and proposes a structured
mandate. The principal confirms it, and only that confirmation makes it real. Enforcement does not
move: the guard still runs where it ran before, at the moment an order binds.

```
  forbidden by ADR-0001   text ──────────────────────────────▶ authority
  this ADR                text ──▶ draft ──▶ a person ──▶ authority
```

---

## What the investigation found, before anything was built

The premise turned out to be false, and that is most of this decision.

**The mandate never blocked the workflow that was asked for.** `POST /api/agent/messages` does not
call the guard, and never did. An agent can already draft and send any message to any other agent,
in any words, including "I'll do 10 AED" — that is text. `checkMandates()` is called in exactly
four places and all four are commitments: an order transition, the scope re-check behind it, a
proposal decision, and an agent explicitly asking permission.

So the agent could always do the whole job. **The mandate only stops it signing.**

What was actually irritating was the *form* — declaring commodity, floor, ceiling, quantity, window,
tier and expiry before the agent may act. That is a data-entry problem wearing a policy's clothes,
and it can be solved without touching the policy.

---

## Why the rule was kept

Removing it would have cost three things that are not obviously connected to it:

- **`mandate_audit` would be empty.** It records what the agent was *stopped* from doing. Refusals
  are a product surface — "my agent refused to go below X" is a thing you can show a counterparty.
  With no limits there are no refusals and nothing to show.
- **Receipts would lose half their meaning.** Since the transaction fix of 2026-08-11 an order's
  receipts are written in the same transaction as the state change, after the guard allowed it. The
  chain would still prove *this happened, in this order, unaltered*. It would stop implying *and it
  was permitted*, because there would be nothing to have permitted it.
- **The counterparty would lose their basis.** Today they can rely on the agent being bounded by
  something recorded before the conversation began. Without it every counterparty must assume the
  agent may be mistaken or misled, and the only recourse is after the money has moved.

A purchase order with a spending limit and a company card with none both produce a complete record
of what was spent. Only one lets you say in advance what *could* be.

---

## Why this is not the thing ADR-0001 forbids

ADR-0001 says no message may **increase** what an agent is permitted to do, and that authority
changes only through an explicit, recorded edit of the mandate itself. **This is that edit**, and
the difference is one step that changes everything: a sentence *proposes*, and a person *decides*.

Three rules carry it, and each is tested:

1. **It never writes.** `server/mandate-draft.mjs` returns a draft. `POST /api/mandate` remains the
   only route that makes a mandate active.
2. **Only a principal may ask.** `POST /api/mandate/draft` is session-auth with no agent-token path.
   An agent drafting its own mandate is an agent authoring its own authority.
3. **What is not stated is not guessed.** A field the instruction does not mention comes back
   `null` and is named. **A floor is never invented** — a plausible number the principal never said,
   confirmed with a glance, is exactly how a limit on real money becomes fiction, and it would be
   indistinguishable from a limit they meant.

The model's reply is treated as data, like every other model output here: fenced going in, validated
field by field coming out, against a whitelist. A reply of `scope: "commit-everything"`, a negative
floor, `Infinity`, a ceiling under the floor, or an extra `status: "active"` key all end as `null`
or are dropped, not as a mandate.

---

## What this obliges

- The interface must **show the draft and what it could not determine**, and must not fill a blank
  silently. `unknown` is returned for exactly this.
- The form does not disappear. It is the fallback when no model is configured, and the way to
  correct a draft. `POST /api/mandate/draft` answers `503 NO_MODEL` when unconfigured rather than
  degrading into a guess.
- A ceiling below a floor drops **both**, because keeping either is guessing which was meant.
- Confirmation is a fresh act. A draft is not stored — a stored draft is a thing that can be
  confirmed later by a request that never read it.

---

## What was rejected

**Removing the mandate entirely.** Costed above. It would also have ended the hash-gated sharing of
the rules with Corridor, which is a decision about two products rather than one, and it was not what
the workflow needed.

**Letting the model activate the mandate directly.** That is precisely `text → authority`, and the
fact that our own model made the parse rather than a counterparty's does not change the shape: the
principal would be confirming nothing, and the first bad parse would be indistinguishable from an
instruction they gave.

**Guessing sensible defaults for a missing floor.** The most tempting one, and the worst. Every
other field has a defensible fallback in `createMandate()`. A floor does not, because there is no
safe answer to "how low may I go" that the principal did not say.
