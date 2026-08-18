# Appeal: contest a limit without inventing a panel

_Branch: `cursor/comment-appeal-475b`._

Hidden Words shipped the automatic `limit` rung and left the author with nothing to press.
Viewpoint B in `PREMIUM-SOCIAL-V1.md` forbids shadowban theatre: if something of yours is limited,
you get a receipt, and you can reply to it. STANDARD.md §5 is the sentence: *"Reply to the receipt
on your account."* ADR-0007 §4–5: every enforcement action writes a receipt; the appeal goes to the
same human; the interface says so rather than implying a panel.

This is that path. It is not an operator dashboard.

## What exists to build on — do not invent a parallel system

Read first: `docs/specs/HIDDEN-WORDS.md`, `shared/moderation-actions.mjs`,
`docs/decisions/ADR-0006-takedown-retains-purge-destroys.md`,
`docs/decisions/ADR-0007-moderation-posture.md`, `docs/STANDARD.md` §5,
`docs/specs/TAKEDOWN.md` (CLI queue; no web moderation desk).

A filtered comment is already the `limit` rung. Release already appends `moderation.restored`.
The operator queue already lists hidden comments. The Receipts tab already says the appeal goes
to the operator of this node and there is no panel. None of that is a thing the author can *do*.

## THE DECISIONS

**1. POST `/api/works/:id/comments` stays silent.** Hidden Words decision 2 is still the law for
the write: 200, and the JSON is byte-identical whether the filter fired or not. Do not toast
"your comment was hidden". That is how they write it again, angrier, from another account.

**2. A filter hit writes a receipt.** ADR-0007 §4: every enforcement action writes a receipt.
Hidden Words skipped this. The type is `moderation.limited` with `source: 'filter'` — the same
rung, not a new concept. Identifiers and dispositions only; never the comment body, never the
matched term (TAKEDOWN.md: receipts hash identifiers, not payload bytes that may need to vanish).

**3. GET may tell the author, and only the author.** The SQL predicate does not change: others
never receive the row. For the author's own hidden comments, the payload may include `hidden` and
`appealed`. A client that filtered the list on those fields would be filtering a list that already
excludes everyone else's hidden comments — do not add that filter. There is no public "HIDDEN"
badge.

**4. Contest is `POST /api/comments/:id/appeal`.** Session, author only. The subject must be
hidden. 409 if already contested. Agent token 401 — an agent is not the person the limit happened
to. Store `appealed_at` + `appeal_body` on the comment (the operator reads them from the existing
queue). Append `moderation.appealed`. Never edit the hide receipt; a reversal is a forward record.

**5. There is no panel, and no `/app` operator desk.** The appeal lands on `GET /api/moderation/queue`
(appealed hits first, with the body). Release is still CLI. Copy says the appeal goes to the
operator of this node. If `OPERATOR_NAME` is set, that name appears on the author's appeal path
only. If it is not set, say "the operator of this node" — do not invent a name.
`report.reviewed_by` stays NULL.

**6. `appeal` is not a rung.** Same shape as `release`: recorded, callable on its own path,
absent from `AVAILABLE_ACTIONS`. The report-resolution enum stays `dismiss | limit | takedown`.

## Build

### Shared
- `shared/moderation-actions.mjs` — `appeal` (rung null, `moderation.appealed`). Sentence for a
  filter-sourced `moderation.limited` is not "the operator reviewed a report"; that would be a lie.

### Server
- `comment.appealed_at`, `comment.appeal_body` via `ensureColumn`.
- Filter insert and its receipt in one transaction.
- GET comments: `hidden` / `appealed` only when `c.user_id === viewer` and `hidden_at` is set.
- `POST /api/comments/:id/appeal` — rate-limited, compare-and-swap on `appealed_at`.
- Queue hidden rows carry `appealedAt` / `appealBody`; appealed sort first.

### Client
- Receipts tab: the sentence for the type, the existing "no panel" copy, and a contest form when
  the latest act on that comment is still `moderation.limited`.
- WorkDetail: on **own** hidden comments only, a quiet "Only you can see this" and the same form.
  Not a toast at POST time. Not a client-side hide of anyone else's comments.

## Tests
- POST of a hit is still 200 and byte-identical to a clean POST.
- A hit appends `moderation.limited` with `source: 'filter'`; payload has no body and no term.
- GET: author sees `hidden: true`; another viewer does not see the row; another viewer's visible
  comments do not carry `hidden`.
- Author may contest; 409 the second time; non-author of a hidden comment gets 404; agent token
  401; clean comment 409.
- Queue shows the appeal body; release still appends `moderation.restored` without editing the
  hide or the appeal.
- `AVAILABLE_ACTIONS` is still `dismiss | limit | takedown`.
- WorkDetail does not mention `hidden_at` and does not `.filter` the comments list.

## Done
`npm run build && npm test` green. Do not deploy. Do not touch `.env`.
