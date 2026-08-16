# The compose window gives the least space to the most important thing

_Brief for the second-engineer seat (Cursor). Branch: `feat/compose-layout`._

The owner's verdict on the shipped window was **"it doesn't look good"**. This brief is written
from a screenshot of the real thing — Chrome at 1440×900, signed in, one 1200×1500 photograph
attached — not from reading the source, which is how it got this way.

## What is actually wrong

**1. The photograph is the smallest thing on screen.** It renders as a ~140px thumbnail in the
top-left of a 690px-wide row. The picture is the entire subject of the post and it is dwarfed by
its own caption box. Instagram gives the image most of the modal, because the image is the thing
being judged.

**2. There is a void.** Between that thumbnail and the "Add more" box on the far right sits roughly
450px of nothing. Not whitespace — a gap that reads as a rendering fault.

**3. "Add more" floats, disconnected.** A dashed square pinned to the right edge, unrelated to the
thumbnail it belongs beside. It looks like a second, separate dropzone.

**4. The zoom control sits ON the picture** and eats a third of an already-small preview. A control
for framing an image must not cover the image.

**5. Two Cancels.** One top-right, one beside Share. Same word, same action, twice.

**6. The location fieldset is the loudest box in the window.** A heavy border around a secondary,
optional field, while the caption — the thing most people will actually fill in — has none. Visual
weight is upside down.

## The shape to build

Three stacked bands, each the full width of the modal.

**Band 1 — THE PICTURE, and it is the hero.** A single large stage, centred, roughly **380–420px
tall**, showing the current image at the selected ratio (`aspect-ratio` + `object-fit: cover`, the
mechanism already in use). This is where the eye lands. Everything else serves it.

**Band 2 — the controls that act on the picture**, directly under the stage, on one line:
- the **zoom** control (− slider +) — **below the image, never over it**
- the **ratio** chips (Original · 1:1 · 4:5 · 16:9), which already exist and are fine

**Band 3 — the film strip**, and **only when there is more than one picture, or to add one**:
a compact horizontal row of ~64px thumbnails under the controls. The current one is marked. **"Add
more" is the last tile in that strip** — same size, same rhythm, immediately after the pictures it
extends. Never pinned to the far right. Each thumbnail keeps its remove ✕. The strip scrolls
horizontally if it overflows; the modal never does.

Then caption, then location, then the actions.

## Other fixes in the same pass

- **One Cancel.** Keep the top-right control as a **×** (icon plus `aria-label`, not the word), and
  keep the worded *Cancel* beside *Share* where the decision is actually made. Two identical words
  in one window is a choice presented twice.
- **Level the visual weight.** The location row loses its heavy border and becomes as quiet as the
  caption — a label, the button, the note. If anything gets emphasis it should be the caption.
- **The modal must fit.** At 1440×900 the whole window has to be usable without the page scrolling
  behind it; give the modal `max-height: 88vh` and scroll its *body* if it must, never the page.
- **Mobile.** At 390px wide the stage shrinks with the modal, the strip stays scrollable, and the
  controls wrap rather than clipping. Check it at that width before calling it done.

## While you are here — the profile's empty state

Screenshot of `/app/account` with no posts shows **two calls to action saying the same thing**: a
full-width gradient *Create new post* button inside a bordered card, and then the words *"Share your
first photo"* as bare unstyled text below it, outside the card. The second reads as debris left
behind rather than an invitation.

**One invitation.** Put the wording inside the card — the button is the action, the sentence is its
explanation — and delete the orphan line.

## Do not

- Do not change the ratio/zoom/location BEHAVIOUR. This is layout, weight and hierarchy only.
- Do not reintroduce `cdda5cb` — the profile grid stays square.
- Do not add a title field back.

## Done
`npm run build && npm test` green (468 at time of writing), commit in the house style. Do not deploy.
