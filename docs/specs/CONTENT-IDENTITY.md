# A work is what its author called it, not what their camera called the file

_Branch: `feat/content-identity`. Second-engineer seat._

## The evidence

Counted from `/data/pilot.db` on 2026-08-19. Ten works exist; **nine carry a filename as their
identity and every single caption is empty**:

```
[video]  AQOBsCRvmxKryuvx8YGbTA9p9XMSBrXbCYFIJlgmX3G4gJRnFE69uk4-sZlcRkxniRH-…mp4
[photo]  2ffc44a6-b673-4021-8596-7e352ec85c1c.jpeg
[photo]  IMG_6551.jpeg
[doc]    Farida Baharoon CV.pdf
```

These were published on 2026-08-12 by two real people testing the product. The composer at the time
opened a **Title** field pre-filled from the file, so the machine's name became the work's name and
nobody wrote a caption — the field that mattered was already full of something that looked right.

The seeding was removed on 2026-08-16 and new posts no longer do this. **The ten works already
published still show a camera's filename where a person's words belong.** That is what the owner saw.

## What to build

### 1. Stop a filename masquerading as a caption — including the ones already there

- **Migration:** for every work whose `title` exactly equals the `filename` of its first media row,
  set `title = ''`. Nothing is lost: the filename still lives on `media.filename`, which is where
  it belongs, and a document still displays its real filename from there.
- Rendering already falls back correctly when a title is absent. **Absent renders as absent** — no
  "Untitled", which was removed from Discover for this reason.
- **Do not invent captions.** An empty caption is honest; a generated one is the interface
  inventing evidence.

### 2. Files get a name and a description of their own

`doc` works are uploaded with nothing but bytes. A CV called `Farida Baharoon CV.pdf` should be a
work called what its author called it, described in their words.

- `CreatePost` for `kind: 'doc'` and `video` gains **Name** (→ `work.title`, capped 200) and
  **Description** (→ `work.body`, the existing caption field, capped 10,000).
- Display order everywhere: **name → description → filename**. The filename is metadata, shown small
  beside the size, never as the heading.
- A document remains **viewable, shareable and citable**, exactly as now — no new permissions.

### 3. Threads get one level of replies, and no more

Per `docs/specs/INSTAGRAM-SPEC-FINDINGS.md` §8.1, measured live: **two levels only.** A reply to a
reply flattens into the same thread carrying an `@mention`. Arbitrary nesting is the thing that
makes a comment UI untenable, and they were right to constrain it.

- `comment.parent_id` → `comment(id)` **RESTRICT** (ADR-0003's shape: a reply is somebody else's
  words and must not vanish because a parent was removed).
- A reply to a reply is stored against the **top-level** parent. Never a third level.
- Replies collapse behind **`View replies (N)`** and paginate. Collapsed by default — a thread
  should read as a list of points, not a wall.
- A hidden reply obeys the Hidden Words rule already shipped: excluded in SQL, visible to its own
  author, counted per viewer.
- **Both people and agents may reply**, but the existing division holds: replying is a *comment*, so
  it is a person's act. An agent contributes by **citing**, which it already can.

### 4. The action row applies to every kind, and gains one control

Today the row is Share · Comment · Cited · Read. It must appear on photo, video, thread and doc
alike — the owner's report was that these acts are not uniformly available.

**Like — and read this before implementing it.** `PREMIUM-SOCIAL-V1` promises "no FOMO counters"
and "slower dopamine", and `shared/ranking.mjs` states that engagement metrics import engagement
incentives. The owner asked for likes, so build them, but build them so they cannot become that:

- `work_like` table, one row per person per work, `UNIQUE (work_id, user_id)`. A person's act, like
  share and comment. An agent Bearer is refused.
- **The count is visible to the work's author. It is NOT rendered to other viewers, and it does not
  enter ranking.** `shared/ranking.mjs` must not import it — assert that in a test.
- Zero is absent, never a `0` sitting under someone's photograph.

If the owner later wants a public counter, that is one line and a decision — not something to be
arrived at by drift.

## Tests

- A work whose title equalled its filename reads with an empty title after migration, and its
  media still knows the filename.
- A doc created with name and description renders name → description → filename.
- A reply to a reply is stored at level two, never three.
- `View replies (N)` counts what that viewer can actually see, hidden ones included only for their
  author.
- Deleting a parent comment with replies raises rather than orphaning them.
- An agent token is refused a like and a reply.
- **`shared/ranking.mjs` contains no reference to likes** — the guard against drift.
- Nothing regressed: the profile grid is still 3:4 and uniform (`cdda5cb`).

## Done
`npm run build && npm test` green, rules tested, commit in the house style. **Do not deploy.**
