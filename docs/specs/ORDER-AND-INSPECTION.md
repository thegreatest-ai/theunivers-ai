# Order and inspection — specification

**Status:** draft · nothing here is built yet
**Covers:** from "we agree the terms" to "the money is released", plus the third-party inspection
that decides whether it should be.

Specs live outside `docs/` proper and are deliberately excluded from `scripts/docs-check.mjs`,
which verifies that documents describe code that exists. A spec describes code that does not.

---

## The scenario

A buyer tells their agent to find organic tomatoes. The agent searches, returns five sellers with
prices shown in the buyer's currency, and is told to negotiate with three. It comes back with terms
— price, size, quality, shipping time. The buyer agrees. The agent prepares a customised purchase
order and sends it to the seller's agent, who reviews and approves. Funds are committed and held
until the goods arrive. On arrival the shipment is inspected; if it matches, the money is released.
If it does not, the finding goes back to the seller's agent, and unresolved cases escalate to a
human.

Steps 1–6 are covered by existing machinery (mandates, the guard, the proposal flow). This spec is
steps 7 onwards.

---

## What this deliberately does not do

**The platform never holds money.**

CBUAE Federal Decree-Law No. 6 of 2025, **Article 62**, makes a platform that "facilitates,
intermediates, or enables" payment services licensable *even when it is not a PSP*. Article 175
makes unlicensed operation criminal. The deadline is 16 September 2026 and counsel questions Q0–Q5
are unanswered.

Holding an agreed amount pending delivery is escrow, and escrow is the clearest possible case of
"enabling". So:

| The platform does | The platform does not |
|---|---|
| decide **when** money should move | move it |
| record that funding was confirmed | hold funds |
| record that release conditions were met | release funds |
| prove who agreed to what, and when | take custody of anything |

`payment.confirmed` and `payment.released` are receipts **about the world**, written when a
licensed provider or the parties' own banks report a fact. Every invariant survives — the chain
still proves the agreement, the inspection and the release — and the licensable act is absent.

This mirrors `verified-work/docs/CODE-STANDARD.md`, which already names the payment boundary.

---

## The order

One object that steps 7–11 hang from. Created only when **both** agents' mandates permit it.

| Field | Notes |
|---|---|
| `id`, `buyer_agent_id`, `seller_agent_id` | |
| `commodity`, `spec_template_id` | the spec template is the agreed quality definition |
| `price` | `{ amount, currency }` — **the currency it was agreed in, never converted** |
| `quantity` | `{ value, unit }` |
| `delivery_window` | `{ from, to }` |
| `inspection_policy` | see below |
| `status` | the state machine |
| `created_at`, and a timestamp per transition | |

### States

```
drafted ──▶ offered ──▶ accepted ──▶ awaiting_funding ──▶ funded
                │                                            │
                ▼                                            ▼
            withdrawn                                     shipped
                                                             │
                                          ┌──────────────────┤
                                          ▼                  ▼
                                     inspected           delivered
                                          │                  │
                                          ├──────────────────┘
                                          ▼
                              settled  ◀── release conditions met
                                          │
                                          ▼
                                      disputed ──▶ resolved
```

Rules that hold at every transition:

- **The guard runs on both sides.** A buyer's agent cannot move an order in a way its own mandate
  forbids, and neither can the seller's. Neither party's agent can move it alone where the terms
  bind both.
- **Every transition writes a receipt** into the append-only chain, with the previous hash.
- **A transition is never inferred from chat.** See ADR-0001.
- **Approval by a principal may supply a missing `SCOPE` and nothing else** — the same rule the
  proposal flow already enforces.

---

## Inspection

### Two-ended, not one

Inspection happens at **origin** before shipment and on **arrival**, and either party may commission
either.

This is not thoroughness for its own sake. With arrival-only inspection, "the seller shipped bad
goods" and "transit destroyed them" produce identical evidence, and the dispute that will dominate
this platform has no resolvable form. An origin record makes the same dispute decidable: either the
goods were bad when they left or something happened in between, and liability follows.

### The inspector is an ordinary agent

No new machinery. An inspector is an individual with a mandate:

| Mandate field | Meaning for an inspector |
|---|---|
| `price_floor` | minimum fee they will accept |
| `spec_template_id` | which inspection forms they are competent to complete |
| `scope` | whether they may take jobs alone or must ask their principal |
| `counterparty_min_tier` **(on the buyer's side)** | "only an inspector at T2 or above" |

The **customised form is a spec template**. The guard already refuses an intent whose
`specTemplateId` does not match the mandate, so an agent cannot accept goods against a spec it was
never authorised to judge.

### Job lifecycle

```
posted ──▶ claimed ──▶ checked_in ──▶ submitted ──▶ accepted ──▶ fee_due
                 │                                      │
                 ▼                                      ▼
             expired                                 rejected ──▶ disputed
```

`checked_in` is the evidence step below. `fee_due` is a receipt, not a transfer.

---

## Assurance

Evidence is graded, and the grade is recorded. A buyer sets a minimum the same way
`counterparty_min_tier` already lets them demand standing.

| Level | Requires | Costs |
|---|---|---|
| `self` | photo, no location | least |
| `web-attested` | live capture + browser geolocation + network position + timing, scored for **consistency** | more |
| `device-attested` | native app with Play Integrity / App Attest and OS mock-location detection | most |

**Why grading rather than a boolean.** `navigator.geolocation` is trivially spoofable — DevTools
sensors, a browser extension, Android's mock-location developer option. We know this first-hand:
setting Chrome's sensor override to `29.7604, -95.3698` makes any page believe you are in Houston.
A platform that treats that number as proof makes its most valuable artefact its easiest forgery.

The useful finding from that same test: **device geolocation and network geolocation are separate
signals with different attack costs, so the check is consistency, not location.** Any one signal is
forgeable; disagreement between them is informative.

`device-attested` needs a native app and is out of scope for now. The tier exists in the schema so
that later inspections are distinguishable from earlier ones rather than silently equated.

### The real bond is standing

An inspector at T3 spent months of clean work getting there, and `onsite_visit` anchors — strength
1.0, the highest in the table — are what gate T4 and the right to vouch for others. A faked
inspection burns all of it. For a $30 fee, fraud has to be worth more than the reputation it
destroys, and it is not. **This is a stronger defence than any signal we can collect**, and the
signals mainly exist to make the fraud detectable enough to burn.

---

## Evidence capture

At `checked_in`, in the app:

1. **Live frame only.** `getUserMedia`, never `<input type="file">`. A file input allows any
   existing photo; a media stream forces a frame from the camera now.
2. **Platform nonce in shot.** A short code issued for this check-in, shown on screen and captured
   in the frame, so last week's photo of the right warehouse does not work.
3. **Location requested by the platform, at a moment the platform chooses** — unannounced, inside
   the delivery window, with a short window to respond. Faking a fix you did not know would be
   asked for is materially harder than faking a scheduled one.
4. **EXIF stripped, never read.** EXIF GPS is attacker-controlled. Coordinates come from the
   reading the platform requested, not from what the file claims about itself.
5. **Hash at capture.** SHA-256 over the image bytes, written into the receipt. The image may then
   live anywhere and remain provably the one submitted.

### What is stamped, and what is stored

```
visible on the image        lat 25.197197   lng 55.274376
                            10082026  143207
                            nonce 7K4Q

recorded in the receipt     latitude   25.197197
                            longitude  55.274376
                            accuracy_m 18
                            observed_at 2026-08-10T14:32:07Z
                            source     device | network
                            assurance  web-attested
                            sha256     9f3c…a71b
                            nonce      7K4Q
```

Two decisions in that table:

**The watermark is for humans; the hash is the proof.** Text drawn on an image is trivially forged.
What makes the photo evidence is that its hash entered the chain at capture.

**`ddmmyyyy` is stamped, ISO-8601 UTC is stored.** `10082026` is 10 August in the UAE and 8 October
in the USA — this platform spans both, and a dispute should never turn on which reading was meant.

### Receipts record observations, never verdicts

A receipt saying *"the inspector was present"* is a claim the system cannot support. A receipt
saying *"the device reported these coordinates at this time, the network agreed to within one
emirate, capture was live, assurance web-attested"* is true, and stays true when challenged.

**For a product whose thesis is receipts you can trust, overclaiming is the worst available
failure** — worse than a weak signal honestly labelled.

### Privacy: a check-in, not a tracker

One fix at one moment, not a trail. Uber follows the journey because it needs to; we need to know
someone was somewhere once. Continuous location on a named individual is sensitive personal data
under the UAE PDPL — open as counsel question **Q4** — and a trail we do not need is liability we
did not have to accept.

---

## Open questions

1. **Who arbitrates?** "The platform authorised person" needs a defined role, a standard of proof,
   and a published outcome. Arbitration without a stated standard is just an opinion with a badge.
2. **How does the inspection fee move?** Same payment boundary; same answer required.
3. **What happens to standing after a wrong finding?** An inspector whose finding is overturned
   should lose something, or inspection quality has no feedback.
4. **Is `device-attested` worth a native app?** Only measurable once web-attested inspections exist
   and their dispute rate is known.

## Build order

1. **Order object + state machine + receipts** — the spine everything attaches to
2. **Listing and quote** so discovery returns something real
3. **Inspection job + evidence capture** at `web-attested`
4. **Agent-to-agent messaging**
5. **The runner** — last, so it operates a loop that already exists

The runner comes last on purpose. Its hard requirement is already recorded in ADR-0001:
counterparty text reaches a model as delimited data, never as instruction.
