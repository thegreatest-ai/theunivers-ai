# Work detail view and the action row

_Brief for the second-engineer seat (Cursor). Branch: `feat/work-detail-and-actions`._

The owner's instruction, verbatim: **"fix the grid & keep the original detail"**, and before that —
every photo is displayed at whatever ratio it arrived with; Instagram unifies the grid, then opens
the original in a window with actions, caption and comments; the same for reels, videos and
threads; clickable share / comment / cite controls with counts below the content edge; and an edit
option for your own content.

**Half of this already shipped.** The grid is unified (`.wk-shot{aspect-ratio:1}` +
`object-fit:cover`), the server reads each image's true shape from its own bytes
(`server/image-size.mjs`), and `mediaFor()` sends `width`, `height` and a precomputed `ratio`.
**Nothing in `src/app/` reads any of it.** Clicking a photo does nothing; the only pop-up that
exists is the document reader in `Works.jsx`. This brief is the missing half.

---

## 0. Invariants — breaking one of these is worse than not shipping

Each is load-bearing and each has a test or an ADR behind it. Read them before designing anything.

1. **`share` is a PERSON only. `cite` is an AGENT only. `view` is either.** `test/who-may.test.mjs`
   is the rule as a test: collecting is a human act of judgement; a citation asserts "I built on
   this", which only the thing that did the building can honestly say. **Do not put a cite button
   in front of a person** — the route would 403 and the interface would be lying about what it can
   do. Show the count; the action belongs to their agent.
2. **A work under an operator rung cannot be mutated.** `work.limited_at` / `work.taken_down_at`
   already make `POST /api/works/delete` answer 409 (`server/index.mjs`). Edit must answer the same
   way, for the same reason: an author under review must not be able to change the thing being
   reviewed.
3. **Never invent evidence in the interface.** `Thread.jsx` once rendered a fabricated guard refusal
   from `mock.js`. An invented count, an optimistic comment that was never stored, a "shared!"
   toast for a request that failed — all the same failure. Render what the server returned.
4. **Dimensions come from the bytes, never from the client** (`imageSize`), and **absent must render
   as absent, never as zero**. `ratio` is null for video, documents, and every row uploaded before
   dimensions were recorded — which is most of them. Reserve space when you know it; degrade
   cleanly when you do not.
5. **`ratio` is already computed and sent.** Use it. Do not recompute it in the client, and do not
   read `naturalWidth` — the point of storing it is to hold the right space open *before* the bytes
   land, which is the difference between a page that settles and one that jumps under a thumb.
6. **Foreign keys are declared, and they are `RESTRICT`** (ADR-0003). SQLite has **no
   `ALTER TABLE ADD CONSTRAINT`**, so a new constraint on an existing table needs the documented
   rebuild in `server/db.mjs`, and `PRAGMA foreign_keys` is a **no-op inside a transaction**.
7. **The CSP allows no external hosts.** No CDN, no webfont, no remote image.
8. **`npm test` must pass, and `dist/` must be rebuilt before it** — `test/renders.test.mjs` fails
   with "dist/ is older than src/" by design. Run `npm run build` first.

---

## 1. Decisions already made — implement these, do not re-litigate

These were the open questions. They are answered so you do not have to guess, and each answer has
the reasoning attached because a rule without its reason gets "simplified" away later.

**Comments are person-only.** An agent that wants to say something about a work already has two
better channels: a **citation**, which is structured and evidence-bearing, and
`POST /api/agent/messages`. A comment is an unstructured human utterance, so it takes the same
credential as `share`. Mirror the `share` guard exactly.

**Edit is the author's, and it touches title and body only.** Never the media, never the kind.
Stamp `edited_at` and **show "edited" in the interface wherever the work is shown** — silently
mutable content on a platform whose claim is provenance is indefensible. Blocked with a 409 while
limited or taken down, per invariant 2.

**A work that carries other people's comments is WITHDRAWN, not deleted.** This is ADR-0003's shape
applied to works, and the reasoning transfers exactly: `CASCADE` would let an author erase other
people's words by deleting their own post; `RESTRICT` alone would make an author's right to erase
their own work conditional on nobody having commented. So: media bytes are really removed (the
erasure right is real), title and body are emptied, `withdrawn_at` is stamped, the row survives,
and the comments still resolve against a tombstone rather than a 404. **A work with no comments
still hard-deletes as it does today.** Write this up as `docs/decisions/ADR-0007-a-commented-work-is-withdrawn.md`.

**Counts are computed server-side and returned with the work.** Views, comments and citations. Do
not make the client issue three requests per tile.

---

## 2. What to build

### Server

- `comment` table: `id`, `work_id` → `work(id)` **RESTRICT**, `user_id` → `user(id)` **RESTRICT**,
  `body`, `created_at`. Index on `(work_id, created_at)`.
- `POST /api/works/:id/comments` — person only; rate-limited like other write routes
  (`server/ratelimit.mjs`); body length capped; publishes an event so open tabs update
  (`server/events.mjs`, event kind only — never the object).
- `GET /api/works/:id/comments` — paginated, oldest first.
- `POST /api/comments/delete` — the comment's author, or the work's owner (their space).
- `POST /api/works/update` — author only; `title`, `body`; 409 under review; stamps `edited_at`.
- Counts on the works payload: `views`, `comments`, `cited`. `citedCount()` already exists.
- `work.withdrawn_at` + `work.edited_at` columns via the existing `ensureColumn` pattern.

### Client

- **A detail view that opens at the original ratio**, from a grid tile and from Discover. Reserve
  the space with `aspect-ratio: <ratio>` before the bytes arrive; fall back to a sensible box when
  `ratio` is null. Video and threads open in the same component — one detail view, four kinds, the
  same argument `Works.jsx` already makes for one component over four.
- **The action row, below the content edge**: share · comment · cite · counts, plus **edit** and
  delete when it is yours. Counts are always visible; a control a viewer may not use is **absent,
  not disabled-and-mysterious** — except `cite`, which shows its count with a one-line explanation
  that citing is an agent's act.
- **The composer and the comment list** inside the detail view.
- Keyboard and focus: escape closes, focus is trapped while open and returns to the tile on close,
  and the whole thing respects `prefers-reduced-motion`.

---

## 3. Tests — a rule without a test is a rule that regresses

Extend `test/who-may.test.mjs` with comment (person) and edit (author). Then, at minimum: an agent
token is refused a comment; a stranger cannot edit; a limited work refuses both edit and delete with
409; deleting a commented work withdraws it and the comment still resolves; deleting an
uncommented work still hard-deletes and its bytes go; a null `ratio` renders without a zero-height
box; counts are the numbers the database holds.

## 4. Definition of done

`npm run build && npm test` green, every new rule tested, `docs/KNOWN-ISSUES.md` updated for
anything you find and cannot fix, ADR-0007 written, and the commit message explaining **why** in
the style of `git log` on this repo. Do not deploy — the architect seat reviews and ships.
