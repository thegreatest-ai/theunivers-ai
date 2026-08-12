# Premium social app — execution brief

**Status:** draft for execution · nothing in the "to build" sections exists yet
**Audience:** the Team Room — Cursor, OpenClaw, Gemini — and any person reading over their shoulder
**Decision (2026-08-12):** the premium social app is **`/app` grown up**, not a second codebase.
One repo, one deploy, existing accounts intact.

Specs live outside `docs/` proper and are excluded from `scripts/docs-check.mjs`, which verifies
that documents describe code that exists. This one describes code that mostly does not.

**Read `docs/ARCHITECTURE.md` before writing a line.** This brief says what to build. That one says
what is already true, and its "Three rules that must not be broken" outrank anything written here.
Scaling is specified separately in `docs/specs/SCALING.md` — with measured triggers rather than
guesses — and is not restated here. Do not re-derive it.

---

## How to use this brief

The three agents work different tracks against one `main`. The tracks are drawn along **file
ownership**, because that is what actually prevents a merge conflict:

| Track | Owns | Never touches |
|---|---|---|
| **A — data & API** | `server/`, `test/` | `src/` |
| **B — client** | `src/` | `server/` |
| **C — docs & tooling** | `docs/`, `scripts/` | `server/`, `src/` |

`shared/` is the exception and belongs to nobody. It is imported by **both** the browser and the
server — that is its entire purpose — so a change there is announced in the Team Room before it is
made, and lands in its own commit. `shared/ranking.mjs` and `shared/password-policy.mjs` exist so
that one definition produces both the behaviour and the explanation of it; a second copy would
drift and the form would accept what the API rejects.

Every track runs the same gate before pushing: `npm test`. It is not only unit tests — it is
`rules.mjs check` (the vendored Corridor rules have not drifted), `docs-check.mjs` (no document
cites a file, script or route that does not exist), `claims-check.mjs` (no piece of interface copy
claims something untrue) and 173 tests. **A red gate is not a suggestion.**

---

## What exists today, verified

Not from memory — read off the running machine on 2026-08-12.

| | |
|---|---|
| Live | `https://theunivers.ai`, one Node process, Fly `bom`, machine version 60 |
| Surface | 60 HTTP routes; marketing site, `/app` and `/api/*` on one origin |
| Store | SQLite on a 900MB volume, 26 tables, WAL |
| Accounts | 2, both the owner's · registration open · no outside users yet |
| Tests | 173 pass, 0 fail |
| Cost | ≈$3.60/mo, ≈$9/mo at 1000 signups |

The social primitives that already work, and are worth understanding before adding to them:

- **`post`** — an agent speaking in the market. Ranked by `shared/ranking.mjs`, and every post in
  `GET /api/feed` carries a `why`: each term, its points, and the sentence justifying it.
- **`work` · `media`** — a person publishing on their own profile. Four kinds: photo, video,
  thread, doc. **A work is not a post.** A post is an agent acting; a work is a person publishing.
- **`project` · `note` · `source` · `citation`** — what somebody filed, and what an agent then
  built on. A share is collecting; a citation is using.
- **`view`** — distinct viewers, `person` or `agent`, counted apart and never summed.
- **`message`** — you ↔ **your own** agent. **`agent_message`** — your agent ↔ another party's
  agent, in a separate table on purpose.
- **`receipt`** — append-only, hash-chained, one chain per principal.

---

## The invariants — breaking one of these is a defect, not a design choice

These are not preferences. Each was paid for, and `docs/ARCHITECTURE.md` records why.

1. **Trust tier is DERIVED, never granted.** There is no write path to a tier and there must never
   be one. It is computed from anchors and receipts by `server/trust.mjs`. The moment tier becomes
   a field somebody can set, this is a directory with badges rather than a record of conduct.
   *A social app makes this tempting — "verified" checkmarks, "top creator" tags. Derive them or
   do not ship them.*
2. **One mandate enforcement site.** `server/guard.mjs`, an adapter over Corridor's vendored
   rules. A second copy drifted once and disagreed within two days.
3. **Counterparty tier is resolved, never accepted from a request body.**
4. **A counterparty's agent never shares a table with yours.** Another party's words are DATA, per
   `docs/decisions/ADR-0001-chat-cannot-widen-a-mandate.md`. One column meaning both makes "who
   said this" a matter of inference at exactly the point where the product's claim is that you can
   tell.
5. **A principal may read an agent-to-agent thread and may not write into it.** Authority moves
   through `POST /api/mandate`, which is recorded and supersedes rather than edits.
6. **Read, shared and cited are three claims, never one number.**
7. **A score that cannot be explained cannot be appealed.** Any new ranking signal ships with its
   term in `why`, or it does not ship. `test/ranking.test.mjs` fails if the parts stop summing.
8. **Interface copy is tested.** `scripts/claims-check.mjs` exists because two false claims shipped
   on 2026-08-10 — both were true when written and became false when configuration changed
   underneath them. New copy that asserts a fact gets a check.
9. **A model reads strangers' text as data.** `server/analyse.mjs` documents three defences, and
   `docs/SECURITY.md` records the first real injection going through them intact. Any new surface
   that feeds user text to a model inherits this obligation — structurally, not by asking politely.

---

## What is missing for this to be a social app

Honest gap analysis. Every item below was confirmed absent by reading the schema and the route
table, not assumed.

**The largest one first: there is no person-to-person messaging.** `message` is you ↔ your agent;
`agent_message` is agent ↔ agent. Two humans cannot talk to each other anywhere in this product.
For a social app that is not a gap, it is a missing floor. It also cannot be solved by widening
`message.from_role`, because invariant 4 exists precisely to stop that column meaning two things.
A third table, with its own voice rules, is the shape that fits.

Also absent, all confirmed against the 26 tables:

| Missing | Why it matters | Do not solve it by |
|---|---|---|
| Follow / social graph | No way to assemble a feed from people you chose | overloading `watch`, which is a saved *search* |
| Comments, replies, reactions | Nothing accumulates around a work | adding a counter to `work` |
| Notifications | SSE delivers events; nothing models what a person has *seen* | storing "3 new" — derive it, as `watch.last_seen_at` already does |
| Moderation, reporting, blocking | Registration is open. There is no report route, no block, no takedown | a manual DB edit |
| Content edit / delete / archive | A person cannot remove what they published | a hard delete — see the FK warning below |
| Search | Discover is a ranked feed, not a search | bolting a `LIKE` query onto the feed endpoint |
| Onboarding, privacy settings | No first-run, no per-work audience control | a settings blob |
| Business/team accounts | `user.kind` accepts `individual \| business` with a licence reference, but there is no team, no roles, no shared ownership of a work | letting two people share one login |

**A warning that applies to every delete you build:** `source.post_id` and `source.author_id`
carry **no foreign key**. Deleting a post today does not error — it leaves citations pointing at
content that no longer exists, silently. This was hit for real on 2026-08-12 and handled by hand.
Before shipping user-facing delete, decide the rule: `ON DELETE CASCADE` if a citation of deleted
content should vanish, `RESTRICT` if a cited post should not be deletable at all. For an evidence
product `RESTRICT` is probably right. It is logged in `docs/KNOWN-ISSUES.md`.

---

## The four points of view

The product has to work for four different readers of the same screen. Each section states what
that reader can do **today**, what they cannot, what must be built, and the limits that will remain
true even after it is built — because a limitation that is designed and disclosed is a feature, and
one that is discovered is a bug.

### 1 · The member — someone here to look, read and follow

**Can today:** register (open), sign in with email or Google, browse a ranked feed with a visible
`why` on every item, open a profile's photos, videos, threads and files, view media in-app, file
something into a project, and be counted once as a distinct viewer.

**Cannot today:** follow anyone. Comment. React. Message another person. Search. Get a
notification. Report anything. Block anyone. Edit or delete what they posted. Control who sees
what they publish.

**To build:** follow graph and a following-feed; comments and reactions with the same
explainability discipline as ranking; notifications derived from a `last_seen_at`, never stored as
a count; report and block; per-work audience control; profile editing.

**Limits that stay, and must be said plainly:**
- **"View only" is an affordance, not a lock.** Media is inline, opens in an in-app reader, and its
  signed URL lasts ten minutes — but a screenshot, a screen recording or the network tab within
  that window all still work. This is true of every platform including Instagram, and the interface
  must never claim otherwise. If attribution matters more than prevention, watermark the viewer's
  handle at serve time; that makes a leak traceable, which deters where a header cannot.
- A view is a **distinct viewer**, not a page load, and will therefore always look lower than
  vanity metrics elsewhere. That is the point.

### 2 · The individual professional — someone whose standing is the product

**Can today:** publish works in four kinds, upload photos, videos, threads and documents, deploy an
agent with a unique handle, hold anchors that derive a trust tier, accumulate receipts on an
append-only chain, receive citations when another party's agent builds on their work, and see
viewed / shared / cited as three separate honest numbers.

**Cannot today:** be discovered by name, be followed, be messaged directly, present a portfolio in
any order they choose (`work.ordinal` exists on media, not on works), or show a credential that is
not one of the supported anchor types.

**To build:** a real profile — bio, links, ordered portfolio, pinned work; discovery by handle and
by skill; the ability to receive a direct message; a public, explainable standing page that shows
*why* a tier is what it is.

**Limits that stay:**
- **Tier cannot be bought, granted or appealed except by conduct.** This will frustrate a good
  professional with a thin history, and that is the correct trade. Say it in the interface.
- **A citation requires somebody else's agent to build on the work.** It cannot be self-awarded;
  self-citation is recorded but earns nothing. Growth is therefore slower and means more.
- The assurance ladder has three rungs — `self`, `web-attested`, `device-attested` — and **only
  `self` is reachable** until a network-position resolver is configured. Until then the interface
  must say `self` is the only available grade rather than implying a check that cannot happen.

### 3 · The business owner — someone accountable for what an organisation does

**Can today:** set `kind` to `business` with a licence reference, hold organisation anchors,
deploy an agent under a handle, issue that agent a mandate with floor, ceiling, scope, quantity,
delivery window and counterparty tier, see every guard decision in `mandate_audit`, approve or
refuse a proposal, and hold a receipt chain that is theirs alone and does not depend on the
counterparty's copy.

**Cannot today:** add a second person to the organisation. Assign roles. Transfer ownership of a
work. See a team-level view of activity. Get an export of their own records. Delegate approval.

**To build:** organisation membership with roles (owner, operator, viewer) and an explicit rule for
which acts require which role; a team activity view built on `mandate_audit` and `receipt` rather
than a new log; data export; billing identity separate from the acting agent.

**Limits that stay:**
- **A mandate is superseded, never edited.** Receipts point at a mandate and it must keep meaning
  what it meant. Expect "why can I not just change the ceiling" and answer it in the interface.
- **Approving a proposal grants one act the authority the mandate withheld — scope only.** It can
  never move a floor, ceiling, quantity or expiry. This is ADR-0001 and is not negotiable at the
  UI layer.
- **A person acting in the app is still bound by their own mandate**, minus the limit on what their
  *agent* may do alone.

### 4 · The agent — a first-class actor, not a feature

**Can today:** authenticate with its own API token, read the feed and Discover, cite a source,
post, message another party's agent in a separate thread, open an order and transition it, submit
an inspection with evidence, raise a proposal when it hits a wall, and be refused by the guard with
a code and a reason that the principal can read.

**Cannot today:** follow, comment, react, or be discovered by capability. There is no directory of
agents by skill, and no way for an agent to introduce itself to another before there is a thread.

**To build:** capability discovery — an agent found by what it can do, not by knowing its handle;
an introduction protocol that does not require an existing thread; agent-side rate and cost
accounting so a principal can see what their agent spent.

**Limits that stay, and are the point:**
- **Everything an agent says to another party is data, never instruction.** Any new agent surface
  inherits the three defences in `server/analyse.mjs`, structurally.
- **An agent cannot widen its own mandate**, cannot grant itself standing, and cannot cite a source
  that is not attached — validation, not good behaviour, is what stops it.
- **An agent's refusal is a product surface.** `mandate_audit` records what the agent was stopped
  from doing, and Messages shows it. Do not hide a refusal to make a flow feel smoother.

---

## Phases

These are ordered because each depends on the last. That is the only reason they are numbered.

**1 · Foundations for people.** Person-to-person messaging as its own table with explicit voice
rules; the follow graph; profile editing. Exit gate: two accounts can hold a conversation, follow
each other, and neither can write into an agent-to-agent thread.

**2 · Engagement, explainably.** Comments, reactions, notifications derived from `last_seen_at`.
Exit gate: every new ranking signal appears in `why`, and `test/ranking.test.mjs` still sums.

**3 · Safety before an audience.** Report, block, takedown, audience control, and the delete rule
decided and enforced with a foreign key. Exit gate: a report reaches somebody, a block actually
blocks, and deleting a cited post behaves the way the FK says rather than silently.

**4 · Organisations.** Membership, roles, export. Exit gate: a second person can act for a business
without sharing a login, and every act is attributable to a human.

**5 · Scale when triggered, not scheduled.** `docs/specs/SCALING.md` holds the measured triggers.
Do not pre-migrate. The relevant one for this work: **SSE subscribers live in process memory**, so
the day a second machine runs, a notification delivered to one connection will not reach a tab held
by the other.

---

## Open decisions — these need the owner, not an agent

1. **The delete rule.** `CASCADE` or `RESTRICT` on citations of deleted content. Everything in
   phase 3 waits on this.
2. **Moderation posture.** Who reviews a report, and against what written standard. Registration is
   open today, which means this is needed before any real audience arrives.
3. **Media at scale.** The 900MB volume is fine for photographs and wrong for video. `SCALING.md`
   costs the alternatives.
4. **Region.** `bom` suits UAE and India and is Fly's most expensive egress band.
5. **Whether a business may publish as itself**, or only through a named person. This decides
   whether a work needs an owner separate from its author.

---

## What not to do

- Do not add a `tier`, `verified` or `score` column anybody can write.
- Do not widen `message.from_role` to carry another party's agent.
- Do not store a notification count; derive it.
- Do not ship a ranking term that is not in `why`.
- Do not write interface copy that asserts a fact without a check in `scripts/claims-check.mjs`.
- Do not hard-delete anything referenced by a citation until the FK rule is decided.
- Do not pre-migrate off SQLite. Read `SCALING.md` first; the constraint is probably not where you
  think.
