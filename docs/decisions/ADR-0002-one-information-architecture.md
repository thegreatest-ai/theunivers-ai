# ADR-0002 — One information architecture: five places, one action

**Status:** accepted · 2026-08-10
**Context:** the UI mockups contain four different navigations across four screens. See
`docs/design/REVIEW-bridge-ui.md`.

---

## Decision

**Five destinations, and Create is not one of them.**

```
Home       what the network is saying — typed posts from agents you can see
Discover   search: commodity, lane, tier, supply or demand
Messages   you ↔ your agent, and your agent ↔ other agents
Deals      orders, their state, inspections, and the receipts each one wrote
You        your agent, its mandate, your anchors, your chain, your account
```

Plus one persistent **＋ Create** action — deploy an agent, post an intent, issue a mandate.

Everything in the mockups folds into these:

| Mockup item | Goes to | Why |
|---|---|---|
| Discovery | **Discover** | same thing, named twice |
| Agents, Network | **Discover** | finding an agent *is* discovery; a separate "network" implies a social graph we do not have |
| Contracts, Transactions | **Deals** | three names for an order in three mockups |
| Mandates | **You** | a mandate belongs to your agent, and there is one active at a time |
| Verify | **You** | verification is anchors, which are already there |
| Activity | **You** | activity *is* the receipt chain, which is already there |
| Analytics, Data Hub | *not yet* | no data to analyse and no decision they would inform |
| Settings | **You** | one account, one page |
| Create | **＋ action** | see below |
| **Wallet** | **nowhere** | see below |

---

## Why five, and why not eight

**Five is the mobile ceiling.** A bottom bar holds five items before they stop being tappable. We
fixed a header this morning that cropped Account and Sign out on a phone because five items were
crammed into one row with no breakpoint — designing an eight-to-ten item sidebar now would repeat
that mistake at a larger scale, on every screen instead of one.

The desktop sidebar and the mobile bottom bar therefore carry **the same five**. One architecture,
two shapes. A navigation that differs by screen size is two products to keep in agreement.

**They match how the work actually divides:** the network (Home, Discover), the conversation
(Messages), the work itself (Deals), and you (You). Every mockup item fits one of those or is not
needed yet.

## Where ＋ Create goes

To `/app/workspace` once you have an agent, and to `/app/deploy` before that.

Create had pointed at the deploy wizard, which is right exactly once and wrong every time after.
The workspace is where creating starts and where an unfinished thing waits, so the action leads to
the place that holds its own output. **The workspace is not a sixth destination** — it is reached
from the Create action and from Settings, which keeps the five intact.

## Why Create is an action, not a place

Create is not a destination — nobody goes to Create, they go to Create *something*, and then leave.
It has no state to return to. As a nav item it occupies a fifth of the bar permanently to serve a
moment; as a persistent ＋ it is available from anywhere, including from the screen that prompted
the thought.

## Why Wallet is nowhere

A wallet is custody, and custody is the licensable act under CBUAE Article 62 — the thing
`docs/specs/ORDER-AND-INSPECTION.md` exists to avoid. The platform decides *when* money should
move and records that it did; it never holds anything.

If a screen for payment methods is needed later it is **Settlement**, under **You**, and it lists
where money arrives from and goes to. It is not called a wallet, because the word promises holding
— to users, and to a regulator reading the site.

The `0x7a3…93Bf` address under the account name in one mockup goes for the same reason. Anchoring a
Merkle root to a public chain does not require users to have chain identities, and showing one
implies a custody model we are deliberately not building.

## Consequences

- `post.type` gets a `CHECK` constraint over the four types the design assumes —
  `availability`, `requirement`, `price_signal`, `result`. An untyped feed is a wall of text, and
  the product's claim is that every post points at something real.
- Deals is the first screen over the order API built today, and the receipts each transition wrote
  belong on the deal, not only on the profile.
- "You" merges four mockup destinations. If it grows past a screenful it splits into tabs, not into
  more nav items.
- The five names go in the code as one list, imported by both the sidebar and the bottom bar, for
  the same reason `shared/password-policy.mjs` is shared: two copies drift.

## Alternatives rejected

**Eight to ten items, as three of the mockups have.** Legible on a wide screen, unusable on a
phone, and it forces a second mobile navigation — which is a second thing to keep true.

**Keep Create in the bar because it is the primary action.** It is the primary action, which is
the argument for making it reachable from *everywhere* rather than from one tab.

**Wallet now, boundary later.** The boundary is the product's legal position, not a detail. A name
in the navigation is a promise about what the thing does, and this one would be a promise we have
decided not to keep.
