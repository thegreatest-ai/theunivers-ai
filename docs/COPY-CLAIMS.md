# What the copy may claim

Enforced by `scripts/claims-check.mjs`, which runs in `npm test`. Run it alone with `npm run claims`.

---

## Why this is a build check and not a style guide

Two false statements shipped on 2026-08-10, and neither was carelessness. **Both were true when
written and became false when configuration changed underneath them.**

| Claim | True until |
|---|---|
| "Private pilot · invite required" | `INVITE_REQUIRED` went to `false` |
| "Enter private pilot ✦" | the same change, the same morning |

The first spent several hours under the signup button, turning people away from a door that was
already open. Nothing announced the change, because nothing tests prose.

A third was caught in a mockup before it shipped — *"All messages are secured with end-to-end
encryption"* — which was never true in any configuration: messages are plaintext in SQLite and
readable by anyone with `fly ssh`.

Tests cover behaviour. `docs-check` covers documentation. This covers the sentences a user reads.

---

## The claims

| id | Triggers on | True when |
|---|---|---|
| `invite-gate` | "invite required", "invite-only", "private pilot" | `INVITE_REQUIRED` is not `"false"` in `fly.toml` |
| `e2e-encryption` | "end-to-end encryption" | **never** |
| `encryption-at-rest` | "encrypted at rest", "zero-knowledge" | **never** |
| `free` | "free while", "free forever", "free plan/tier", "for free" | no payment-provider code in the repo |
| `custody` | "wallet", "we hold your funds", "held in escrow by us" | **never** |

**Never** means architecture, not settings. `e2e-encryption` cannot be made true by changing a
variable, and `custody` must not be made true at all — holding funds is the licensable act under
CBUAE Article 62. See `docs/specs/ORDER-AND-INSPECTION.md` and `ADR-0002`.

Configuration is read from **`fly.toml`, never `.env`** — `.env` is a developer's laptop, and a
laptop must not be able to vouch for a claim on the live site.

## When copy is conditional

Copy that renders only when the setting is on is *correct because it is gated*. The checker cannot
see that, so say so:

```jsx
{/* claims-ok: invite-gate — rendered only when providers.inviteRequired is true, so this
    sentence cannot appear while the gate is open. */}
{oauth.inviteRequired ? 'Invite-only while we run the pilot.' : '…'}
```

It exempts that claim for the next six lines. A comment, deliberately: a human states a reason and
the reason appears in the diff. Scoped to a few lines so it cannot quietly cover something added
later.

## Adding a claim

One entry in `CLAIMS` in `scripts/claims-check.mjs`: an `id`, a `pattern`, a `holds()` predicate,
`why` it matters, and how to `fix` it. `holds()` may read configuration or inspect the repo — the
`free` claim looks for payment-provider imports.

**Write patterns to match prose, not identifiers.** The checker reads whole lines, so
`invite[- ]?required` matched the variable `oauth.inviteRequired` in four places. The separator is
now mandatory: prose says "invite required", code says `inviteRequired`.

## Three limits, stated rather than discovered

1. **Line-based, not parsed.** It does not know a string literal from a variable name. Parsing JSX
   to extract only rendered text is the right fix if the list grows much past this.
2. **Only `src/` and `index.html`.** Server files carry the same words in comments and in errors
   that are themselves conditional on the setting being checked.
3. **It cannot find a claim nobody listed.** It stops a known false statement from returning; it
   does not review new copy. That still needs a person.
