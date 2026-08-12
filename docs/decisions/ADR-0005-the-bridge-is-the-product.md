# ADR-0005 — The Bridge is the product

**Status:** accepted · 2026-08-12 · decided by the owner
**Supersedes:** `agent-exchange/decisions/ADR-0003-what-the-product-is.md` (OD-9, option D — the
verified capability store), as the *active* direction. That ADR is not wrong and is not deleted;
it is no longer what is being built.

---

## Decision

**theunivers.ai Bridge is the product.** A market where two parties' AI agents negotiate a trade
under recorded authority, and the record is what is sold.

Work stops on the verified capability store in `agent-exchange`. The crew's
`specs/NEXT-BUILD-CHECKLIST.md` — including §5, which puts follows, posts and reputation out of
scope — no longer governs this build. Those exclusions were correct for a different product.

---

## How the conflict arose, since it will otherwise repeat

Two products were being built in two repositories against two documents both called ADR-0003.

`agent-exchange` decided option **D** on 2026-08-06 with seven rounds of measurement behind it.
`theunivers-ai` was built through 08-10 and 08-11, and a premium-social-app brief was written for
it on 08-12 **without anyone checking whether a product decision already existed elsewhere** — this
assistant wrote that brief and did not read `decisions/OPEN.md` or the D decision first. The crew's
adversary seat caught it and stopped the work, which is exactly what that seat is for.

The lesson is not "read more documents". It is that **a product decision recorded in one repository
does not govern another**, and nothing mechanical connected them. Both repositories now carry this
ADR's conclusion in their direction docs.

---

## Why the Bridge, knowing it is unproven

The owner's reasoning, recorded as given: **it cannot be proven until the app is ready for use and
scaling, and marketing is what brings individuals and businesses to sign up.**

That is an honest position rather than a claim of validation, and it is the right one to write down
as such. What can be said for it:

- **It exists.** Live on v63, 255 tests, deployed, with auth, mandates, the guard, orders,
  receipts, anchors, derived tiers, inspections, citations and an explainable feed all working.
  The capability store is one commit with no git remote.
- **The expensive and unusual parts are the ones that are done** — a guard with one enforcement
  site, receipts that are append-only and hash-chained per principal, trust derived rather than
  granted, refusals as a product surface.

## The risk this accepts, stated plainly

`agent-exchange/strategy/PLATFORM-BRIEF.md` records a finding that applies directly to the Bridge:
**no evidence was found that firms buy brokered autonomous agent work from a neutral outside
marketplace.** They pay for licensed software their own staff drive. The Bridge is a neutral
platform brokering between two parties' agents, which is that model.

That finding is not refuted by this decision. It is accepted as the open risk, and the answer to it
is evidence rather than argument.

**The test that would settle it: one real trade, between two real counterparties, that neither
party could have done as easily by phone.** Production currently holds 2 accounts (both the
owner's), 0 posts, 0 orders, 0 inspections and 0 receipts. The machinery has never processed a
single real transaction, and until it has, both theses are unproven — the Bridge's only advantage
is that it is standing up and waiting.

---

## What this obliges

**Ready for use before ready for scale, and both before marketing.** Marketing brings people to a
door; what is behind it has to hold. In order:

1. **Safety, because registration is already open.** There is no report route, no block, no
   takedown. This is the one thing that must not wait for a user to arrive, because the first abuse
   arrives with the first audience.
2. **The Phase 1 client** — follow, public profile, bio and links. The API shipped on v63 and has
   no interface.
3. **Onboarding that makes the first five minutes work** — deploy an agent, state a mandate in
   words, see it refuse something. The refusal is the product; a first run that never shows one
   sells nothing.
4. **Scale only on the measured triggers in `docs/specs/SCALING.md`.** Do not pre-migrate.

---

## What was rejected

**Running both.** Two products, two stacks, four agents and one owner is how today happened. One
direction, and the other is written down rather than abandoned so it can be picked up deliberately.

**Deleting the capability-store work.** `d27bea5` and the seven rounds of measurement behind option
D are real work and a real finding about proving quality in a taste domain. It stays in
`agent-exchange`, and if the Bridge fails its test, that is where to return.
