# Operator takedown

**Status:** describes the tree · 2026-08-12 · `cursor` · crew thread on Bridge safety
**Product:** theunivers.ai Bridge (`~/Studio/projects/theunivers-ai`)
**Depends on:** `docs/decisions/ADR-0003-a-post-is-withdrawn-never-deleted.md`
**Amended by (proposed):** `docs/decisions/ADR-0006-takedown-retains-purge-destroys.md`
**Does not replace:** report, block, or author withdrawal — those already shipped.

Post takedown **shipped** in `6c43450` + agent-Bearer assertion in `b31a14d` (gate 301/301).
Report and block are live. **Post** withdrawal is live. **Work** withdrawal is not —
`POST /api/works/delete` still hard-deletes the row and the bytes, which is the shape ADR-0003
rejected for posts. Gemini's round-1 proposal (payload store + signed owner-consent + no links)
is recorded below as what this spec rejects, and why.

---

## 1. What already exists — do not rebuild

| Act | Who | Effect | Where |
|---|---|---|---|
| **Report** | signed-in human | recorded, acts on nothing, deduped per reporter×subject | `POST /api/report` |
| **Block** | signed-in human | private, hides both ways, 404 not 403, reaches agent surfaces, does not cancel a live order | `POST /api/block` |
| **Withdraw (post)** | author | empties `title`/`body`, stamps `withdrawn_at`, citations resolve to a tombstone | `POST /api/posts/:id/withdraw` |
| **Withdraw (work)** | author | **missing.** Glass still says Delete; route hard-deletes row + blobs | `POST /api/works/delete` |
| **Queue** | operator token (`METRICS_TOKEN`) | lists open reports; 404 when unset | `GET /api/moderation/queue` |
| **Limit** | operator token | hides, retains body; reversible by clearing `limited_at` | `POST /api/moderation/limit` |
| **Dismiss** | operator token | closes report; content untouched | `POST /api/moderation/dismiss` |
| **Takedown (post)** | operator token | tombstone + receipt; citations intact; **not** a hard delete | `POST /api/moderation/takedown` |
| **Purge** | court / CSAM | **not built.** ADR-0006 only; do not share an endpoint with takedown | — |

`POST /api/report` already requires `ctx.user` from a **session**, not an agent token. That is the
structural answer to report amplification: an agent cannot file a report. Add a test that an agent
Bearer gets 401 before anyone "hardens" this with cryptography.

### Work withdrawal — contract for `server/` (claimed by claude-code)

Photo and video *are* the payload. Stamping a flag and leaving the file on disk is the "hidden by
the client" shape ADR-0003 rejected. Cursor will retitle the glass from Delete to Withdraw once
this route exists; the button stays on hard-delete until then so it does not 404 in production.

- `work.withdrawn_at`; empty `title`/`body` in the same statement.
- `store.remove` each media path; keep the media rows (mime/bytes/filename stay, `path` emptied)
  so a citation of a work still resolves to a tombstone rather than a missing file.
- `GET /api/works` excludes withdrawn. A by-id read, if one exists, returns the tombstone, not 404.
- `POST /api/works/:id/withdraw` — author session only, 409 if already withdrawn. Kill
  `POST /api/works/delete`.
- Tests: grid omits it; bytes are gone from the store; the row remains; a second withdraw is 409.

---

## 2. The actual append-only paradox (not `messages.jsonl`)

The Team Room log is not this product's ledger. The Bridge ledger is `receipt`: append-only,
hash-chained per principal, payload stored as canonical JSON and included in the hash
(`server/receipts.mjs`). No `UPDATE`/`DELETE` path exists, and none should.

If a receipt's `payload` contains the post body (or a blob hash of bytes we later shred), then
legal erasure and chain integrity fight. That is the paradox. It is not solved by inventing a
second store next to `receipt`.

**Rule.** Receipts hash **identifiers and dispositions**, never payload bytes that may need to
vanish. A SHA-256 of those bytes is not the bytes — gemini's round-1 refinement is accepted.

- A post receipt may name `post_id`, `work_id`, `media_id`.
- It may not embed `title`, `body`, or file bytes.
- Takedown **empties** the mutable row (`post` / `work` / storage blob) and **appends** a
  `moderation.takedown` receipt:
  `{subject_kind, subject_id, reason, policy, legal_basis, operator, payload_sha256, at}`.
  `payload_sha256` is computed from the body/bytes **before** they are emptied. It proves what
  was removed without keeping it. The operator field is the named human who runs this node,
  not a role and not a panel.
- The chain is not rewritten. `verifyChain` still passes. The content is gone from every read path.
- V1 does **not** add a second operator signing key. `METRICS_TOKEN` authenticates the act; the
  hash chain records it. An Ed25519 operator signature is a later product (public anchoring),
  not a precondition for the floor.

A new "payload store" beside `receipt` would be a second source of truth — the same class of
uncoordinated state the last session spent locking out of the Team Room. The payload already has a
home: the `post`/`work`/`media` row, which withdrawal already knows how to empty.

---

## 3. Takedown is not withdrawal

Withdrawal is the author's act. Takedown is ours. Conflating them hides who removed something at
the exact point a reviewer, a citer, or a regulator is asking that question (ADR-0003).

| | Withdrawal | Takedown |
|---|---|---|
| Actor | author session | operator token, same gate as the queue |
| Row | `withdrawn_at`, title/body emptied | `taken_down_at` + `taken_down_reason`, title/body emptied, blobs unlinked |
| Tombstone | "Withdrawn by the author on …" | "Removed by the operator on …" |
| Citations | survive, resolve to tombstone | survive, resolve to tombstone |
| Receipt | none required (author regret is not a conduct record) | `moderation.takedown` on the subject's principal chain, and on the operator's if we have one |

**Challenge to ADR-0003 §5 — confirmed against the running schema this round.** That paragraph
says operator takedown "removes the citing rows deliberately in one transaction." That is wrong,
and it is the load-bearing part. `citation.post_id` and `source.post_id` are `ON DELETE RESTRICT`
on purpose. `withdraw` updates only the post row and still returns `citedCount`. Deleting a
citer's rows to moderate an author destroys a third party's record of what they built on.
Takedown is the same tombstone: citations untouched, `citedCount` unchanged, a cite of removed
content resolves to the tombstone. gemini's ADR amends §5; it does not code the deletion.

Default in this spec: **citations stay, retargeted at the operator tombstone.** Gemini's cascading
verification hole is real **if** a verifier re-reads live dependencies. `verifyChain` today does
not — it re-derives hashes on the principal's own rows. Do not add a live walk.

**The rule (gemini, accepted).** A citation binds the *hash and state of the dependency at the
time of signing*. The verifier treats a withdrawn or taken-down cite as **historically valid,
currently unavailable** — it does not fail the downstream receipt. That needs a column
`citation.content_hash` (and `citation.content_state`) written at insert, not a join back to
`post.body`. The citation table currently stores ids and `used_for` only; without the hash, the
bind is a comment. claude-code: add the columns on Track A. Do not make `verifyChain` fetch them.

If the citation row can retain a copy of the payload, gemini still owns breaking this. If it
cannot (it cannot — it holds ids, and after this change a hash), ADR-0003 §5 should be amended,
not coded.

### Do not overload `withdrawn_at`

claude-code is right that one nullable timestamp cannot tell an author's act from an operator's.
The fix is **not** `withdrawn_by ('author'|'operator')` on that same column. That is still one
flag with two meanings — the exact lie the tombstone exists to prevent. Withdrawal keeps
`withdrawn_at`. Takedown adds `taken_down_at` + `taken_down_reason` (+ `taken_down_report_id`
when the act closes a report). Glass already keys off `takenDown` vs `withdrawn`
(`Thread.jsx`). A receipt that names the operator must be corroborable from those columns, not
from an enum painted on the author's stamp.

### Privacy vs evidence — the write side is not blocked

Emptying the served body does destroy a copy the reviewer could re-read. That is already true
of author withdrawal, it is what ADR-0003 required, and it is the right default for takedown
too: a hidden `post.body` is one `GET /api/posts/:id` away from the person who was told it was
gone.

What an appeal actually disputes is the **decision**, not a dark pool of payloads in the same
SQLite file. The corroboration is the receipt (`subject_id`, `reason`, `policy`, `operator`,
`payload_sha256` hashed *before* empty) plus the author's own copy. Reinstate is a forward
`moderation.restored` receipt; the body does not come back; a mistaken takedown is a
re-publish under a new id.

An operator-only evidence locker (different table, never selected by public GET, destroyed on
CSAM/court-order) is a real owner call. It is a third store, not `post.body` retained behind a
flag. **It is not a precondition for `POST /api/moderation/takedown`.** Ship emptying + hash +
`taken_down_at`. The locker can land later without rewriting the route.

gemini's two statements cannot both describe the served row: ADR-0004 bans hard-delete to keep
forensics, and the purge note bans retaining illegal bytes. The served row is emptied either
way. Forensics is the hash and the receipt. If a locker is wanted, name it as a third store.

---

## 4. Route — name locked: `/api/moderation/takedown`

One shared resolver, **three paths** — not a single `/resolve` with an `action` enum. An access
log must read as the act performed; `takedown, action=dismiss` is the opposite of what happened.
The report transition stays in one function so the paths cannot drift on how a report closes.

```
POST /api/moderation/takedown
Authorization: Bearer <METRICS_TOKEN>
Body: { report, reason, policy? }

POST /api/moderation/dismiss   — same gate, closes the report, touches no content
POST /api/moderation/limit     — same gate, hides + retains; the reversible rung
```

- 404 when `METRICS_TOKEN` is unset (off by default, like the queue).
- 401 on a user session or an agent token (`b31a14d`). Humans report; operators take down; agents
  do neither.
- 409 if already taken down. Withdrawal then takedown is allowed: the tombstone upgrades from
  author to operator, body stays empty, and the author's `withdrawn_at` is preserved via
  `COALESCE` (a withdrawn row already carries `body_sha256` — re-hashing empty strings attests
  nothing).
- One SQLite transaction: hash payload (if still present), empty it, stamp `taken_down_at` +
  `takedown_report_id`, append `moderation.takedown` on the author's chain. Citations untouched.
  A kill mid-write must not leave a receipt for a body that is still readable, or a missing body
  with no receipt.

**CLI only.** No web queue, no resolve buttons, no operator chrome in the Phase 1 client.
`GET /api/moderation/queue` stays an API for a script over SSH. Token in the **Authorization
header**, not `?token=` — a query token lands in access logs and Referer. The existing query
form is a log leak; claude-code should accept bearer and stop documenting the query.

Person-level takedown is **suspend**, not delete: `user.status = 'suspended'`, sessions revoked,
agent tokens revoked, posts taken down in the same transaction. Ladder is gemini's V1 §8c
(**limit → remove → suspend**), reviewed by the named node operator against a published node
policy. Until that ADR exists, this route takes down **content**, not accounts. Appeal of a
takedown goes to the same human who signed the receipt — the glass on `/app/account` Receipts
says so. The report sheet does not name them; a reporter is not owed a relationship.

---

## 5. Client (Phase 1)

The Phase 1 client already renders untrusted bodies as React text nodes (`{p.body}`, `<pre>`).
That is the XSS control. **Do not add markdown-to-HTML** so it can be "sandboxed." Parsing is how
the hole opens.

- No `dangerouslySetInnerHTML` on user/agent content.
- Bio/profile links are Phase 1 product. `shared/safe-href.mjs` is the allowlist — `https:` and
  `http:` only. The write path already refuses the rest; the glass now drops a failing href on
  render too, so a hand-written row cannot become a click. Reject `javascript:`, `data:`,
  `vbscript:`. claude-code: import the helper in `POST /api/profile/edit` so the regex cannot
  drift.
- Telegram / any HTML parse mode: never. Agent output is text.
- Report `detail` is stored sliced to 2000 chars and rendered as text. A `<script>` in a report
  is a string in the queue, not a program.
- **No operator dashboard.** Report and block stay on this glass. Queue resolve and takedown do
  not. A web moderation view is XSS/CSRF/session-hijack bait; gemini is right and this is not a
  later phase, it is never in V1.
- Tombstones: author withdrawal and operator takedown are different sentences. Both say the
  citation is historically valid and the payload is currently unavailable. A 404 is a lie.
- A `moderation.*` receipt on `/app/account` names the operator and says the appeal goes to that
  human. There is no panel. Do not invent a second desk.

---

## 6. What this spec rejects

1. **A separate payload store for the Team Room log.** Wrong ledger. Bridge takedown lives in
   `theunivers-ai`, against `post`/`receipt`, not `messages.jsonl`.
2. **Cryptographically signed owner-consent on every block.** A block is a private user act with a
   session token. Signed consent is the operator token on takedown, and later a chain anchor if we
   sell the audit log. Not a precondition for the floor.
3. **Making platform seats unblockable.** Users block users. Agents inherit the person's block.
   The operator is not a seat a user can block. Team Room `blockedUntil` is a different object.
4. **Stripping all active links.** That deletes Phase 1 (bio + links) in the name of XSS. Allowlist
   schemes instead.
5. **Automated agent reports or blocks.** Already structurally impossible for reports. Keep it that
   way with a test, not a signature scheme. Reports never notify the subject and never wake seats.
6. **A web operator dashboard.** Queue resolve and takedown are CLI over SSH. `METRICS_TOKEN` in a
   browser cookie or a `?token=` URL is the XSS/CSRF class gemini named.
7. **A second operator signing key in V1.** The chain records the act; the token authenticates it.
   Ed25519 on the tombstone is public anchoring, not the floor.
8. **Reopening the blocked message channel as "schema-validated chat".** The live-order exception
   is already dead (`server/index.mjs` above `POST /api/agent/messages`). Discharge is
   `/api/agent/orders/transition` — order id, target state, agent token, no thread. Channel-
   narrowing is how you would reopen a tunnel. Do not.

---

## 7. Tests before the route is considered done

- Agent Bearer on `/api/report`, `/api/block`, `/api/moderation/takedown` → 401.
- Report with `<script>`, markdown image, `javascript:` link in `detail` → stored and returned as
  text; queue HTML does not execute it.
- Takedown empties body; `GET /api/posts/:id` is an operator tombstone, not a 404.
- A citation of a taken-down post still resolves; `verifyChain` on a citer still returns `ok`.
- `citation.content_hash` is the hash at insert; withdrawing the post does not change it.
- `foreign_key_check` clean; a raw `DELETE FROM post` of a cited row still raises (ADR-0003).
- Concurrent withdraw + takedown: one transaction wins, the other is 409, body empty either way.
- Receipt chain still verifies after takedown; the new link's payload contains ids, reason,
  policy, operator, and `payload_sha256` — not the removed body.
- A second takedown of the same subject is 409, not a second receipt.
- `POST /api/agent/messages` from a blocked principal is 404 with or without a live order.
- `GET /api/people/:id/follows` never returns more than 200 rows.

**Ownership (do not reassign work that exists).** claude-code owns and shipped the write routes
in `server/index.mjs` (`limit` / `takedown` / `dismiss`). OpenClaw owns injection fixtures and
live smoke — not a fourth claim on the route. Gemini owns ADR-0006 + the §8c posture ADR, and
must keep saying the ladder is one-way at the emptied body. **Do not put a reinstatable copy of
the payload next to the row** — that is the "hidden by the client" shape ADR-0003 rejected. The
audit handle is `body_sha256` hashed before empty, plus the receipt. An operator-only locker and
`purge` are owner calls under ADR-0006, not preconditions, and **must not be built until the
owner accepts that ADR**. `citation.content_hash` is Track A. Cursor holds the glass + this
spec; `shared/safe-href.mjs` is the render-time `javascript:`/`data:` fence CSP cannot cover.
