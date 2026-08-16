# Discover shows the work, at the shape its author chose

_Brief for the second-engineer seat (Cursor). Branch: `feat/create-post-ratio` (continues)._

`work.ratio` is stored, validated, editable — and changes nothing anyone can see. It appears once
in the entire interface, pre-filling its own edit form. The profile grid is square by instruction,
`WorkDetail` shows the original by instruction, and **`Discover.jsx` renders no images at all**: a
photograph found by search is a line of text.

That makes the ratio selector a control that implies a choice and delivers nothing — the same shape
as the assurance ladder in `docs/KNOWN-ISSUES.md`, *"built, unusable, and looking finished"*. This
brief is what makes it real.

## The rule that governs everything here

**Two surfaces, and they do not agree — on purpose.**

| Surface | Shape | Why |
|---|---|---|
| Profile grid | **always square** | "unified in profile" — a grid is an index, and an index that jumps is not scannable |
| **Discover feed** | **the post's chosen ratio** | a feed is the work presented, so the author's composition decides |
| Detail view | the photograph's true shape | the owner's explicit divergence from Instagram: "keep the original detail" |

Conflating the first two is what caused the regression fixed in `cdda5cb`. Read that commit before
starting. The grid must not change in this work — if `src/app/Works.jsx` or `.wk-shot` appears in
your diff, something has gone wrong.

## Build

- Discover results of kind `photo`/`video` render their first media inline, in a cell reserved with
  `ratioAspect(work.ratio)` **before the bytes arrive** — `aspect-ratio` + `object-fit: cover`.
  `ratioAspect` already exists in `shared/work-ratio.mjs` and is already tested; import it, do not
  reimplement.
- **`Original` (NULL) is the interesting case, and most posts are it.** There is no chosen shape, so
  fall back to the media's own `ratio` from the bytes. When that is null too — video, documents,
  anything uploaded before dimensions were recorded — reserve nothing and let the element size
  itself. **Never a zero-height box**, which is the failure this repo has already shipped once.
- A carousel shows its first image with the existing count marker (`.wk-count`).
- Clicking a result opens `WorkDetail`, which already exists. Do not build a second detail view.
- The same guards the rest of Discover already applies still apply: a limited or taken-down work
  never reaches the feed, a blocked person's work never reaches the viewer.

## Do not

- Do not touch the profile grid.
- Do not re-encode, resize or crop bytes. There is still no image library on the server.
- Do not add a ratio control to Discover — the shape is the author's decision, shown, not editable
  by a reader.

## Tests

- A feed cell for a `4:5` post reserves 4/5; `16:9` reserves 16/9.
- An `Original` post falls back to the photograph's own ratio.
- A post with no dimensions at all renders without a zero-height cell.
- Every cell of the **profile grid** is still square regardless of any of the above — the
  regression test, and it must keep passing untouched.

## Done

`npm run build && npm test` green, the rules above tested, commit in the house style. Do not deploy.
