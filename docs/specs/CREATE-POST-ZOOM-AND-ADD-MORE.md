# Zoom, and a way to add more pictures to the same post

_Brief for the second-engineer seat (Cursor). Branch: `feat/zoom-and-add-more`._

Two things the owner asked for on the Create-new-post window:

1. **Zoom in and zoom out** on the picture being posted.
2. **A button on the right** to choose more pictures for the same post.

## THE DECISION: the frame is per POST, what's inside it is per IMAGE

`work.ratio` is already per post — one frame shape, because a carousel whose slides disagree makes
the viewer's frame jump on every swipe. **Zoom is the opposite: it is per image**, because framing
is a judgement about one photograph. A face wants to be closer; a landscape wants room.

Instagram splits it exactly here — pick the shape once, then frame each picture inside it — and the
split is the reason the feature works at all. So:

- `work.ratio` — the shape of the frame. One per post. **Already built.**
- `media.zoom` — what's inside the frame. **One per image.** New.

## It stays non-destructive, like the ratio

`ADR`-level rule from `CREATE-POST-AND-RATIO.md`, unchanged: **the stored bytes are never
re-encoded, resized or cropped**, and there is still no image library on the server. Zoom is a
number stored beside the image and applied in CSS — `transform: scale()` on the `<img>`, inside a
container that clips.

The consequence is the same and it is the point: **zoom is reversible.** Re-frame a photograph a
year later and lose nothing.

### Where zoom applies, and where it must not

| Surface | Zoom applies? |
|---|---|
| Profile grid (square) | **Yes** — it is a crop, and framing is what zoom is for |
| Discover feed (post's ratio) | **Yes** — same reason |
| `WorkDetail` | **NO** — it shows the photograph's true shape, untouched. Owner's instruction: "keep the original detail" |

A zoomed detail view would quietly make the original unreachable, which is the one thing this whole
design exists to prevent.

### Store the focal point now, even though nothing sets it yet

Add `media.focal_x` and `media.focal_y` (percentages, default 50) **in the same migration as
`zoom`**, and apply them as `object-position: <x>% <y>%`.

Nothing in this brief writes them — zoom alone is centre-origin. They are here because
drag-to-reposition is the obvious next request, and adding two columns now costs nothing while a
second migration later costs a table rebuild (SQLite has **no `ALTER TABLE ADD CONSTRAINT`**, and
this repo has done that dance once already). The follow-up then becomes pure interface work.

Default them, read them, apply them. Do not build the drag.

## Build

### Server
- `media.zoom` (`REAL NOT NULL DEFAULT 1`), `media.focal_x` / `media.focal_y`
  (`REAL NOT NULL DEFAULT 50`), via the existing `ensureColumn` pattern.
- Accept them on `POST /api/works/:id/media`. **Validate: zoom within `1`–`3`, focal within
  `0`–`100`.** Out of range is a `400`, never a clamp — a silently clamped value is a framing the
  author did not choose, and they cannot tell it happened.
- Return them from `mediaFor()`.
- `1` and `50/50` mean "untouched", and every existing media row is already exactly that.

### Client — zoom
- A zoom control per selected picture in `CreatePost`, over the preview: **out (−) and in (+)**,
  plus a range slider. Keyboard reachable, and each control has a real label — not a bare glyph.
- The preview must show precisely what the cropped surfaces will show. If preview and result
  disagree, the control is a lie.
- Video: allowed, same mechanism. Documents and threads: no zoom, no control.

### Client — the add-more button
- **On the right of the preview area**, an "Add more" button that opens the same picker and
  **appends to the selection rather than replacing it.** Replacing is the bug to avoid here; a
  person who has chosen four and wants a fifth must not lose the four.
- Only for kinds where `multiple` is true (photos, files) — absent, not disabled, for video and
  threads.
- Each thumbnail gets a **remove** control, because a way in with no way out is how people end up
  cancelling the whole window to drop one picture.

### The cap — 10, and enforce it on the server
Instagram allows ten. **We currently allow unlimited**, which the add-more button makes much easier
to hit, and a 200-image carousel would wreck the detail view.

- `POST /api/works/:id/media` refuses the eleventh with a **409** naming the limit.
- The client stops offering *Add more* at ten and says why.
- **The server is the gate**, the client is the courtesy — same rule as the password policy.

## Tests
- Zoom out of range → 400. Focal out of range → 400. Neither is clamped.
- Defaults are `1` and `50`; a row that predates this reads as untouched.
- The eleventh image is a 409, and the tenth is not.
- `WorkDetail` does not apply zoom — assert it, since this is the invariant most easily lost.
- Adding more appends and never replaces.
- The profile grid is still square (the `cdda5cb` regression test must keep passing untouched).

## Done
`npm run build && npm test` green, rules above tested, commit in the house style. Do not deploy.
