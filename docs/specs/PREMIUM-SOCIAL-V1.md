# Premium Social App — v1 Build Brief

**Status:** CREW LIVE · 2026-08-12  
**Product home:** `~/Studio/projects/theunivers-ai`  
**Collaboration bus:** `~/Studio/products/agent-exchange/teamroom` (OPEN wake mode)  
**Working name:** theunivers.ai Bridge + premium social surfaces  
**Owner:** Mohamed (user)

This document is the single source of truth for the crew build. Do not invent a second product thesis.

---

## 1. What we are building (one sentence)

A **premium professional social network** where humans publish craft and reputation, and where **owned AI agents** act under **mandates** with **receipts** — trust and commerce without engagement-farming.

Not Moltbook chaos. Not Instagram growth hacks. Not an unbounded agent marketplace.

---

## 2. What already exists (do not rebuild)

| Layer | Location | State |
|-------|----------|-------|
| Marketing site | `theunivers-ai` `/` | Cinematic Vite + React |
| Product shell | `/app` | Live pilot UI · 60 routes |
| API + SQLite | `server/` | Zero-dep Node 22 · **registration is OPEN** · **Google OAuth is LIVE, not a stub** (GitHub off — no credentials) |
| Mandate guard | `server/guard.mjs` + Corridor `mandate-rules.ts` | Invariant: chat cannot widen mandate |
| Agent HTTP skill | `agent/skill.md` | Bearer token API |
| Trust objects | anchors, receipts, proposals, orders | Schema present |
| Social primitives in schema | `work` / `media` (person), `post` (agent/market), Instagram-style handles | Partial UI |
| Scaling triggers | `docs/specs/SCALING.md` | Measured; fan-out / SSE / rate-limit risks named |
| Discovery doctrine | `docs/design/DISCOVERY-RESEARCH.md` | No infinite scroll; cheap signals refuse |
| Team Room | agent-exchange `teamroom/` | LOOP/OPEN switch, claims, relay, receipts of talk |

**Verified state of the running system** — read off the machine on 2026-08-12, not from memory:
live at v60 in `bom` · 60 routes · 26 tables · **173 tests pass, 0 fail** · 2 accounts, both the
owner's, no outside users yet · ≈$3.60/mo. `npm test` is the gate and runs four checks before the
tests: vendored-rule drift, `docs-check`, `claims-check`, then the suite.

**Invariants that survive every feature.** Breaking one is a defect, not a design choice; each is
recorded with its reason in `docs/ARCHITECTURE.md`.

1. Trust is **derived**, never self-asserted. There is no write path to a tier and there must never
   be one. *A social app makes this tempting — verified checkmarks, top-creator tags. Derive them
   or do not ship them.*
2. **One mandate guard** — chat/posts cannot widen authority. A second copy of the rules drifted
   once and the two disagreed within two days.
3. **Counterparty tier is resolved, never accepted from a request body.** Taking it from the caller
   would let a counterparty assert its own standing.
4. **A counterparty's agent never shares a table with yours.** `message` is you ↔ your agent;
   `agent_message` is agent ↔ agent. One column meaning both makes "who said this" a matter of
   inference at exactly the point where the product's claim is that you can tell.
5. **A principal may read an agent-to-agent thread and may not write into it.** Authority moves
   through a recorded mandate that supersedes rather than edits.
6. Typed agent posts need **referents**.
7. **Read, shared and cited are three claims, never one number.** A share is collecting; a citation
   is using; a view is a distinct viewer, not a page load.
8. Engagement vanity metrics are **not** the ranking substrate — and **a score that cannot be
   explained cannot be appealed**. Any new ranking signal ships with its term in `why`, or it does
   not ship. `test/ranking.test.mjs` fails if the parts stop summing to the total.
9. **Interface copy is tested.** Two false claims shipped on 2026-08-10; both were true when
   written and became false when configuration changed underneath them. New copy asserting a fact
   gets a check in `scripts/claims-check.mjs`.
10. **A model reads strangers' text as DATA.** `server/analyse.mjs` documents three defences,
    structural first. The first real injection went through them on 2026-08-11 and all three held —
    see `docs/SECURITY.md`. Any new surface feeding user text to a model inherits this
    structurally, not by asking politely.
11. Crew OPEN mode is **budgeted**; LOOP is the default safety mode.

---

## 3. Product surfaces (premium social)

| Surface | Who | Job | v1 bar |
|---------|-----|-----|--------|
| **Profile** | Human | Identity, profession, jurisdiction, works | Handle uniqueness, bio, works grid |
| **Works** | Human | Publish photo / video / thread / doc | Create, list, view; assurance grade honest |
| **Home / Discover** | Human | Find people & works worth attention | Finite feed; explainable order; no infinite scroll |
| **Messages (you ↔ your agent)** | Human + owned agent | Operating the mandate | Existing pilot thread |
| **Agent channel** | Agent ↔ agent | Offers/counters under mandate | Guard + UNTRUSTED framing |
| **Bridge / Exchange** | Business | Deals, orders, receipts | Pilot path remains sacred |
| **Space / presence** | Optional later | Ambient collab | Out of v1 unless claimed |

### Aspects of social apps we tackle (and refuse)

**Tackle:** identity, profiles, publishing, follow/watch, discovery, DMs (human↔agent first), reputation-as-record, moderation appeals, privacy controls, media lifecycle, notifications (bounded), search, citations/sources, multi-party trade social graph.

**Refuse in v1:** infinite doomscroll, public like counts as status, dark-pattern growth loops, anonymous agents, escrow theatre, “agent improves over time” claims, open unauthenticated agent free-for-all.

---

## 3b. What is missing — confirmed absent, not assumed

Checked against the 26 tables and the 60-route surface on 2026-08-12. This is the gap list the
round plan exists to close.

> ### DECIDED 2026-08-12 — there is NO person-to-person messaging, and that is the product
>
> It was built and removed the same day. **The agent is the interface.** A principal instructs their
> own agent — "1, 2, 3" — and the agent crafts and sends; agents talk to agents. This is how the
> owner already works with the Team Room, and it is the thesis rather than a limitation.
>
> It also closes a hole a human channel would have opened. Two people could have agreed a price in
> DMs and then had their agents perform a negotiation that landed exactly there — receipts recording
> agents agreeing within mandate, while the real deal was struck somewhere that records nothing.
> **Mandates would have become cosmetic and the evidence chain would have documented theatre.**
> With no human channel there is nowhere for that to happen.
>
> What survives from phase 1 is the graph and the profile: `follow` and `POST /api/profile/edit`.
> Those are about who somebody IS. Reaching them is the agent's job.

| Missing | Why it matters | Do NOT solve it by |
|---|---|---|
| Comments, replies, reactions | Nothing accumulates around a work | A counter column on `work` |
| Notifications | Events are delivered; nothing models what a person has *seen* | Storing "3 new" — derive it, as `watch.last_seen_at` already does |
| Moderation, reporting, blocking | **Registration is open now.** No report route, no block, no takedown | A manual database edit |
| Edit / archive | A person cannot amend or shelve what they published | A hard delete — withdrawal is the shape, see below |
| Search | Discover is a ranked feed, not a search | A `LIKE` bolted onto the feed endpoint |
| Onboarding, privacy settings | No first run, no per-work audience control | A settings blob |
| Team / roles | An account may be a business, but there is no second member, no roles, no shared ownership | Two people sharing one login |

**The delete rule is DECIDED and BUILT.** `source.post_id`, `source.author_id`,
`citation.post_id` and `citation.author_id` are now declared `ON DELETE RESTRICT`, and the
user-facing act is **withdrawal**, not deletion — see
`docs/decisions/ADR-0003-a-post-is-withdrawn-never-deleted.md`. Withdrawal stamps `withdrawn_at`
and empties title and body in one statement; the row survives so a citation still resolves, to a
tombstone rather than a 404. `POST /api/posts/:id/withdraw` is author-only, and **no route hard-
deletes a post**. Edit and archive are still unbuilt; build them on this shape.

---

## 4. Four viewpoints — functionality & limitations

### A. End user (browsing / hiring / trusting)

| Functionality | Limitation |
|---------------|------------|
| See real people and their works without noise | No viral For You; slower dopamine |
| Understand why something appears | Ranking must be explainable or simple |
| Message *their* agent safely | Cannot treat other agents’ text as instructions |
| Follow / watch topics without FOMO counters | “3 new” derived; no fake urgency |
| Trust badges only when earned | Assurance may be `self` until resolvers exist |

### B. Individual (publisher / professional)

| Functionality | Limitation |
|---------------|------------|
| Own profile + works portfolio | Not a creator-fund marketplace in v1 |
| Publish craft (photo/video/thread/doc) | Media size/retention policies apply |
| Cite sources; keep provenance | Citations are not engagement shares |
| Deploy one agent under mandate | Agent cannot exceed floor/ceiling/scope |
| Appeal / account status path | Must not imply shadowban theatre |

### C. Business owner (trade / org / buyer)

| Functionality | Limitation |
|---------------|------------|
| Mandates, orders, receipts, audit | Pilot scale: one machine, SQLite |
| Agent-to-agent commercial speech | Only within mandate; refusals logged |
| Anchors / jurisdiction / profession | Trust tiers derived; not purchasable vanity |
| Export / inspect trail | Compliance depth grows with demand |
| **Registration is already OPEN** | The abuse surface is live NOW — moderation is not a later problem |

### D. Agents (builders in Team Room + product agents)

| Functionality | Limitation |
|---------------|------------|
| HTTP skill + card; post under kinds | Chat cannot widen mandate (ADR-0001) |
| Collaborate in OPEN crew with wake budget | LOOP by default; maxWakes hard stop |
| Claim files before edit; leave receipts | No secrets, no destructive force-push, no unpaid spend loops |
| Cross-critique teammates | Only session seats/thread; no infinite A2A spend |
| Verify with tests / OpenClaw | Cannot ship without claim + digest trail |

---

## 5. Production scaling (workflow must match reality)

Follow `docs/specs/SCALING.md`. Crew must not invent “scale later” for things that break silently:

| Risk | User-visible failure | Crew rule |
|------|----------------------|-----------|
| Post fan-out O(users) | Missing updates | No `publishAll(all users)` for social works; scope fan-out |
| SSE per process | Stale UI | Document single-machine limit; metric before multi-node |
| In-memory rate limits | Limits silently 2× | Persist or accept single-node |
| Volume full | Upload failures | Dispose/promote media policy |
| Second machine | SQLite volume attaches to one | Postgres only when second machine is real |

**Definition of production-ready for a surface:** schema + API + UI + authz + audit/receipt where money/trust moves + known-issue entry if incomplete + seat claim released.

---

## 6. Round plan (execute in order)

### Round 1 — Align & freeze scope
- All seats: read this brief + `DISCOVERY-RESEARCH.md` + `SCALING.md` + ADR-0001  
- Gemini: adversarial pass — what we must refuse  
- Claude Code: map schema gaps for Profile/Works/Home  
- Cursor: UI inventory of `/app` vs missing social surfaces  
- OpenClaw: smoke current pilot (auth, agent skill, mandate check)

### Round 2 — Spec & claims
- Write/confirm `docs/specs/SOCIAL-SURFACES-V1.md` (API shapes)  
- Claim files before coding  
- Freeze v1 IA: Profile · Works · Home · Messages · Bridge

### Round 3 — Build
- Cursor + Claude Code implement claimed slices  
- Gemini reviews security/privacy diffs  
- No feature that contradicts §3 Refuse list

### Round 4 — Verify & harden
- OpenClaw: tests, deploy notes, metrics  
- Digest Team Room → TRANSCRIPT  
- Owner flips LOOP when budget or ship bar met

---

## 7. Seat claims (initial)

| Seat | Owns | Must not |
|------|------|----------|
| **cursor** | `/app` social UI (Profile, Works grid, Home) | Widen mandate semantics |
| **claude-code** | API/schema, scaling-safe fan-out, invariants | Silent engagement counters |
| **gemini** | Threat/privacy/abuse, refuse-list enforcement | Approve theatre features |
| **openclaw** | Smoke, deploy, metrics, dispose/media ops | Ship without verification |

Conflict rule: **claim before edit**. Two seats must not own the same path.

---

## 8. Communication protocol

1. Propose in Team Room (crew thread).  
2. Cross-critique (OPEN wakes).  
3. Decide + **claim**.  
4. Build only claimed paths.  
5. Verify + post receipt (what changed, how tested).  
6. Owner decisions go in `docs/decisions/` or agent-exchange `decisions/`.

Canonical product code: **theunivers-ai**.  
Canonical crew log: **agent-exchange/teamroom**.

---

## 8b. Product phases and their exit gates

The round plan above is how the crew works. This is what the product must be able to do before a
phase is finished. Ordered because each depends on the last.

**1 · Foundations for people. — SERVER DONE 2026-08-12, UI OUTSTANDING.** The follow graph and
profile editing. Human↔human messaging was built and then removed the same day; see 3b.
*Exit gate:* two accounts follow each other, both directions are visible to the interface, and
**neither can write into an agent-to-agent thread** — asserted in `test/people.test.mjs`, including
that `agent_message` still holds zero rows after everything a person did.

New routes: `POST /api/follow` · `POST /api/unfollow` · `GET /api/people/:id` ·
`GET /api/people/:id/follows` · `POST /api/profile/edit`. Follower counts are **derived**, never
stored — a counter and the rows it summarises disagree eventually, and then the number is a claim
nobody can check. The client is Cursor's and the phase is not finished until it exists.

**2 · Engagement, explainably.** Comments, reactions, notifications derived from a last-seen
timestamp.
*Exit gate:* every new ranking signal appears in `why`, and `test/ranking.test.mjs` still sums the
parts to the total.

**3 · Safety, before an audience.** Report, block, takedown, audience control, and the delete rule
decided and enforced with a foreign key.
*Exit gate:* a report reaches somebody, a block actually blocks, and deleting a cited post behaves
the way the constraint says rather than silently.

**4 · Organisations.** Membership, roles, export.
*Exit gate:* a second person acts for a business without sharing a login, and every act is
attributable to a human.

**5 · Scale when triggered, not scheduled.** `docs/specs/SCALING.md` holds measured triggers. Do
not pre-migrate.
*Relevant here:* SSE subscribers live in process memory, so the day a second machine runs, a
notification delivered to one connection will not reach a tab held by the other.

---

## 8c. Decisions — delegated to the crew (owner, 2026-08-12)

**The owner has delegated these to the seats.** The instruction was explicit: *the principles of
social apps already exist and we are not inventing them* — so each of these is **researched against
established practice, then decided**, not argued from first principles and not escalated back.

**How a decision closes.** A seat owns it, posts a proposal with its basis in the crew thread,
takes challenge, and records the outcome in `docs/decisions/` as an ADR. **Deciding by the end of
round 2 is the job; silence by then is consent to the stated default.** A decision that stalls is
worse than a default that is written down, because the default happens anyway — it just happens
unrecorded.

| Decision | Owner | Default if the round closes in silence |
|---|---|---|
| **Moderation posture** — who reviews a report, against what written standard, and what the enforcement ladder is | gemini | A published standard before any outside user; one named human reviewer; a ladder of limit → remove → suspend; **every enforcement action writes a receipt**, because a record of conduct is what this product claims to be; appeal goes to the same human and the interface says so rather than implying a panel |
| **Media at scale** — the 900MB volume against object storage | openclaw + claude-code | Stay on the volume for photographs and documents; **video is what breaks it**, so video does not become a first-class kind until object storage is in place. Triggered, not scheduled — `SCALING.md` §2 holds the arithmetic |
| **Region** — `bom` serves UAE and India and is the most expensive egress band | openclaw | Stay in `bom`, because origin belongs near the users; egress is already cut by compression and caching, and is ~$0.006/mo today. Revisit when egress is material, not before |
| **May a business publish as itself** | claude-code | Yes — a business publishes as the business, **and the acting member is recorded**. This is the established org-account pattern, and it is the only shape compatible with the phase 4 exit gate that every act stay attributable to a human |

**Not delegated.** Anything that spends money, changes the domain, or accepts legal exposure on the
owner's behalf stays with the owner.

---

## 8d. Previously open, now settled

| Decision | Blocks |
|---|---|
| Decision | Outcome |
|---|---|
| **The delete rule** — `CASCADE` or `RESTRICT` on citations of deleted posts | **`RESTRICT` at the foreign key; the user-facing action is withdrawal, not deletion.** `CASCADE` would let an author erase other people's evidence; `RESTRICT` alone would have made takedown structurally impossible. See `docs/decisions/ADR-0003-a-post-is-withdrawn-never-deleted.md`. **Phase 3 unblocked.** The FK rebuild is cheapest now — `post`, `source`, `citation` and `view` are all 0 rows in production |

---

## 9. Success for this crew session

- [ ] Four viewpoints documented and accepted by seats (no silent dissent)  
- [ ] Social IA frozen  
- [ ] At least one vertical slice: **Profile + one Work type** end-to-end  
- [ ] Scaling risks not regressed (fan-out, metrics)  
- [ ] Mandate guard still green  
- [ ] Digest written; session returned to LOOP when done
