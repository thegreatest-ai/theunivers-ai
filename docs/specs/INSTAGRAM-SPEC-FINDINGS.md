# What the Instagram spec corrected — including me

_Source: `Instagram-Product-Design-Spec.pdf`, v1.1, prepared for thegreatest.ai, dated 2026-08-18.
Its numbers come from a **signed-in session inspected live** on that date — computed styles, element
measurement, and the web create flow walked to the upload dialog — not from research. That
distinction is the whole value of the document._

## The correction that lands on us

**The profile grid is 3:4 portrait, not square.** Measured live at 215.8 × 287.7px — ratio 0.750
exactly, centre-cropped, every post forced to that shape regardless of what it was published at.
Instagram moved the grid from 1:1 to 3:4 in early 2025.

I had asserted square. Worse, I asserted it *in a commit message about the danger of misremembering*
— `cdda5cb` reads "it is also what Instagram does, which is easy to misremember". It was, and I did,
by more than a year. The spec's own warning applies exactly:

> If you had built from research alone, your app would have shipped looking a year out of date.

**What did not change is the rule.** The owner's instruction — *"the photo display in profile will be
unified in profile"* — is satisfied by any single shape. Only the number was mine, and only the
number was wrong.

**Also corrected: the gutter is 1px, not 4px, and certainly not our 8px.** The spec's reasoning is
the useful part: a hairline is why their grid "reads as a single photographic surface rather than a
set of cards". The gap was doing more work than its size suggests.

**And the accept list**, taken from the live file input: `image/avif, image/jpeg, image/png,
image/heic, image/heif, video/mp4, video/quicktime`. AVIF is in; GIF and BMP are not. We were
missing AVIF and HEIF. We keep `image/webp`, which they do not offer — that is ours, and refusing a
format we can already display would be a restriction with nothing behind it.

## What it confirmed about decisions we had already made

- **Carousel: slide 1 sets the ratio, every later slide is cropped to match.** The spec calls this
  "the number-one carousel gotcha". It is exactly the call recorded in `CREATE-POST-AND-RATIO.md` —
  ratio belongs to the post, not to each image — arrived at independently and for the same reason.
- **Grid centre-crops; the feed does not.** Two surfaces, deliberately disagreeing. Their grid is
  3:4 and their feed post is 4:5 — different numbers for different surfaces, which is the structure
  we already have.
- **Carousel cap.** Instagram's app now allows 20; Meta's own API still caps at 10, and the spec
  says "design for both". Our 10 stands.
- **Crop presets:** 1:1 · 4:5 · 1.91:1 · Original. Ours — Original · 1:1 · 4:5 · 16:9 · 9:16 — is a
  superset, and 16:9 sits close enough to 1.91:1 that adding theirs would be a distinction without a
  difference.

## What we are deliberately not taking

Part 8 draws the line in the same place `clean-buildable-product-standard` does, which is
reassuring: **functionality is free** — a photo feed, a 3-column grid, carousels, double-tap to
like — **trade dress is the risky zone**, and the name, wordmark, camera glyph and Instagram Sans
are absolutely off limits.

Named as do-not-take, and worth repeating because they are the tempting ones: **the 5-stop brand
gradient** ("the single most identifying asset Instagram has, more than the wordmark"), the camera
glyph, anything with "insta" or "gram" in the name, their icon SVGs, and **filter names** —
Clarendon, Juno, X-Pro II are branded looks; copy the effect and rename it.

Their practical test is a good one: *put the two home screens side by side on a phone — could a
distracted person tap the wrong one?* If yes, change the colour signature and the icon, not the
feature list.

## Things worth knowing that we have not acted on

- **Their primary button is `#4A5DF9` indigo, not `#0095F6`.** The decade-old "Instagram blue" is
  gone from buttons. We have no reason to match either — our identity is our own — but it is the
  clearest evidence in the document that design facts rot.
- **Create was evicted from the mobile tab bar** in Oct 2025 and moved to the top bar; DMs took the
  centre slot. The most-complained-about change in their redesign. We put ＋ Create in a floating
  button, which is neither, and we should decide that deliberately rather than by default.
- **~110 distinct destinations** on mobile. Useful for scale expectations, not a target.
- **Gestures are cheap to add and extremely expensive to move** — their removal of
  swipe-left-to-DMs generated sustained complaint for months.

## The lesson to keep

This is the fourth time in this repo that a confident claim about the outside world turned out to be
stale — after DMARC, `busy_timeout`, and the CORS header. The rule already written in
`docs/KNOWN-ISSUES.md` is **assert production from production**. This extends it: **assert other
people's products from their products.** An hour in DevTools beats any amount of recall, and the
document says so in the same words.
