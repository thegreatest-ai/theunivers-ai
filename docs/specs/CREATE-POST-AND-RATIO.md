# Create new post: a window, then a shape, then the bytes

_Brief for the second-engineer seat (Cursor). Branch: `feat/create-post-ratio`._

Observed by the owner in Instagram, 2026-08-16, and this is the whole of what we are copying — the
**sequence**, not the look:

> On an empty profile there is an option to share your first photo. Clicking it opens a new window
> titled **"Create new post"**. Inside the window you can drag photos and videos, or select from
> computer.

## What we do today, and why it is wrong

`src/app/Works.jsx` → `addFiles()` runs: `createWork` → `uploadMedia` for each file → `load()`.

The file input's `onChange` **is** the commit. There is no step between choosing a photograph and it
being stored, so there is nowhere for a decision to live. That is the entire reason every image
lands at whatever shape it happened to be, and why a profile grid reads as salvaged rather than
composed. The empty state is a passive note — *"Nothing here yet."* — where Instagram puts an
invitation.

**The fix is structural, not cosmetic: put a room between the picker and the upload.**

---

## THE DECISION: one ratio per POST, and it never touches the bytes

Two calls made here. Both are the architect seat's, both are overrulable by the owner, and the
reasoning is recorded because a rule without its reason gets refactored away.

### 1. The ratio belongs to the work, not to each image

A carousel whose slides disagree about shape makes the viewer's frame jump on every swipe. One
ratio for the whole post is why an Instagram carousel feels settled. So `ratio` is a column on
`work`, chosen once, before the first byte is sent — **not** a property of each `media` row.

### 2. It is a PRESENTATION choice, and the original is kept

This is where we deliberately differ from Instagram, and the owner's instruction is the reason:

> **"fix the grid & keep the original detail"**

Instagram's crop is destructive — choose 4:5 and the post *is* 4:5 everywhere, forever. Ours is
not. The chosen ratio governs **the grid and feed cell**; `WorkDetail` still opens the photograph
at its true shape, which is already built and already shipped. So:

- **Never re-encode or crop the stored bytes.** The server has no image library and should not gain
  one for this.
- The ratio is applied with `aspect-ratio` + `object-fit: cover` on the cell, exactly as
  `.wk-shot` already does with its hardcoded `1`.
- The stored `width`/`height` from `server/image-size.mjs` stay the truth about the file.

The upshot: a chosen shape is **reversible**. An author can change a post's ratio later and lose
nothing, which a destructive crop can never offer.

### Options to offer

`Original · 1:1 · 4:5 · 16:9`

`4:5` is the tallest worth allowing — beyond that a portrait dominates a feed. `Original` must be
the default and must be a real option, because it is the honest one: it says "this is the shape the
photograph is", and for documents and threads it is the only sensible answer.

---

## What to build

### Server

- `work.ratio` — `TEXT NULL`, via the existing `ensureColumn` pattern. NULL means Original, and it
  will be NULL for **every work that already exists**, so absent must render as the true shape,
  never as a broken cell.
- Accept `ratio` on `POST /api/works`, validated against the four allowed values — **an unknown
  value is a 400, never a silent default**, because a typo'd ratio that quietly becomes `1:1` is a
  layout bug nobody can trace.
- Allow `ratio` on `POST /api/works/update`, subject to the rules that already exist there: author
  only, 409 while limited or taken down.
- Return `ratio` on the works payload.

### Client

- **The empty state becomes an invitation**, per kind: "Share your first photo" rather than
  "Nothing here yet."
- **A `CreatePost` window**, opened from that invitation and from the existing add control. It is a
  modal and must reuse the focus discipline `WorkDetail` already implements — escape closes, focus
  trapped, focus returns to the opener, `role="dialog"`. Do not write a second one; extract if
  needed.
- Inside: a **drop zone that also takes a click** ("Drag photos and videos here · Select from
  computer"). One control, two ways in — the same argument the current `accept` attribute already
  makes about phone versus desktop.
- After selection, **before upload**: thumbnails of what was chosen, the ratio selector, and the
  title/caption field. **Then** a single explicit *Share* button that runs the existing
  `createWork` → `uploadMedia` sequence with the ratio attached.
- Cancel must discard cleanly and upload nothing.
- The grid cell reads `work.ratio` instead of the hardcoded `aspect-ratio: 1`.

### Not in scope

Filters, adjustments, and drag-to-reposition within the crop. Repositioning is the one worth
revisiting later — it would be an `object-position` focal point stored beside the ratio, still
non-destructive — but it is not v1.

---

## Tests

- An unknown ratio is a 400; each of the four allowed values round-trips.
- A work created before this change has `ratio` NULL and its cell renders at the true shape.
- Every slide of a carousel presents at the post's ratio, not its own.
- The bytes are byte-identical after upload — **assert this**, because it is the invariant that
  makes the choice reversible.
- Changing ratio via update obeys the author and 409 rules already tested.
- Cancelling the window uploads nothing.

## Done

`npm run build && npm test` green, the rules above tested, and a commit message explaining why.
Do not deploy — the architect seat reviews and ships.
