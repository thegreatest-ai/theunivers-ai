# What the Instagram UI Kit actually contains

_Read from the Figma REST API on 2026-08-16, file `KHBR6zwYRaD4XiPPjY7KHB` — "Instagram - UI Kit
4.0 (Community)" by Stan Gursky, duplicated into the owner's account so it becomes API-readable.
Community files are not: the API answers 403 until the file is yours._

**The headline finding is a negative one, and it decides the next build.**

---

## The kit has NO upload, crop or ratio-selection flow

Searched all 201 node names across the Components and Screens pages for
`crop|ratio|upload|create|new post|aspect|4:5|1:1|16:9`. **One hit: "Edit Bar"** — story editing,
not upload.

The nineteen screens are all **consumption**, each in Light and Dark:

| | |
|---|---|
| Feed · Feed-Ads | the post and its action row |
| Reels · Story · Highlights | video and ephemeral |
| My Profile · User Profile | the grid |
| Splash · Empty Screen | states |

So the one thing most wanted from this kit — *"prior to the uploading insta will specify to user the
ratio selection"* — **is not in it.** That flow has to be designed from the interaction model, not
copied. Nothing here is a substitute for that, and no amount of further reading of this file will
produce it.

## What IS usable: the numeric foundations

These are scales, not trade dress. Safe to adopt, and worth adopting — the reason our interface
looks less settled than Instagram's is not the icons, it is that spacing and radius are ad hoc.

**Spacing** — `2 · 3 · 4 · 6 · 8 · 10 · 12 · 16 · 24 · 32 · 48 · 56 · 64 · 80`

Dense at the bottom (2–12 for component interiors), sparse at the top (32+ for section rhythm).
Note what is **absent**: no 5, no 7, no 20. Fifteen steps for a whole product.

**Radius** — `0 · 2 · 4 · 6 · 8 · 12 · 16 · 20 · 24 · 100`

`100` is the pill/circle token — avatars, story rings, pill buttons. One token, not a magic number
scattered around.

**Border** — `0 · 0.5 · 1 · 1.5 · 2 · 2.5 · 3`

Half-pixel steps, which matter on the 2× and 3× displays every phone now has.

## What I could NOT reliably extract

**The type ramp.** The Typography page's own documentation tables are set in 12px/16px, so a
frequency count over that page measures the *spec sheet's* type, not Instagram's. The honest read
is that 24/500 and the 56px weights are display specimens, and the interface ramp is somewhere in
9–16px — but this file did not give it to me cleanly, and a type scale guessed from contaminated
data is worse than keeping ours.

**Colour tokens.** The Colors page has `Semantic Tokens` and `Primitive Tokens` frames, but no
published library styles (`/styles` returns zero — expected for a community duplicate), so the
values live in Figma variables. Reading those needs the variables endpoint, which is Enterprise-only.

## The line this repo will not cross

`clean-buildable-product-standard` requires work that is **IP-safe for us**. That splits the kit:

- **Adopt** — the numeric scales above. Nobody owns 8px.
- **Adopt** — the interaction model: unified grid, tap to detail, action row with counts, comments
  under the content. Functional patterns, used by every social product.
- **Do not adopt** — Instagram's glyphs, logo and distinctive visual identity, which is what most
  of this file actually is. We are a commercial product in the UAE, not a clone.

## Next

The ratio selector at upload is unbuilt and unspecified. `src/app/Works.jsx` `addFiles()` takes the
files and posts them straight through, so every photograph still arrives at whatever shape it
happened to be. The grid already crops to a square cell and `WorkDetail` already opens at the
stored ratio — **the missing piece is letting the author choose the shape before it is committed**,
which is what makes a profile grid look composed rather than salvaged.

That is a design task, not an extraction task, and it is the next brief.
