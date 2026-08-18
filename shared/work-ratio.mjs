/**
 * Presentation ratios a work may take.
 *
 * One per POST, never per image — a carousel whose slides disagree about shape makes the
 * viewer's frame jump on every swipe. NULL in the database is Original: the photograph's
 * own shape. Every work that already exists is already NULL, which is the honest default,
 * and for documents and threads it is the only sensible answer.
 *
 * This is not a crop of the file. The bytes stay as they were uploaded; the FEED cell uses
 * `aspect-ratio` + `object-fit: cover`. The profile grid is square regardless — those are
 * two surfaces that deliberately disagree. A later change of this value loses nothing, which
 * a destructive crop can never offer. The server has no image library and must not gain
 * one for this.
 *
 * ONE list, imported by the server (the gate) and the browser (the selector). Two copies
 * would drift, and a typo'd ratio that quietly becomes 1:1 is a layout bug nobody can trace.
 */

export const WORK_RATIOS = [
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '16:9', label: '16:9' },
  // 9:16 — the full-height portrait a phone actually shoots, and the shape a reel or story is
  // published at. Taller than 4:5 by a long way: 4:5 is a portrait that sits IN a feed, 9:16 is a
  // portrait that IS the screen.
  { id: '9:16', label: '9:16' },
];

/** CSS aspect-ratio number for a chosen presentation id. Original has none of its own. */
export function ratioAspect(id) {
  if (id === '1:1') return 1;
  if (id === '4:5') return 4 / 5;
  if (id === '16:9') return 16 / 9;
  if (id === '9:16') return 9 / 16;
  return null;
}

/**
 * Parse a request value. Unknown is an error, never a silent default.
 *
 * Returns `{ missing: true }` when the field was omitted (CREATE defaults to Original;
 * UPDATE leaves the stored value). Returns `{ value }` where value is the column to store
 * (`null` for Original), or `{ error }`.
 */
export function parseWorkRatio(raw) {
  if (raw === undefined) return { missing: true };
  if (raw === null || raw === 'original') return { value: null };
  if (raw === '1:1' || raw === '4:5' || raw === '16:9' || raw === '9:16') return { value: raw };
  return { error: 'unknown ratio' };
}

/**
 * THE PROFILE GRID IS 3:4 PORTRAIT, AND UNIFORM. Not square — that was my error, twice over.
 *
 * The first version let each cell follow work.ratio, which put the ragged grid back. I corrected
 * it to a square in cdda5cb and wrote, in that commit, that a square "is also what Instagram does,
 * which is easy to misremember". It was easy to misremember, and I misremembered it.
 *
 * Instagram changed the profile grid from 1:1 to 3:4 in early 2025. Measured in a signed-in
 * session on 2026-08-18: 215.8 x 287.7px, ratio 0.750 exactly, centre-cropped, every post forced
 * to that shape regardless of what it was published at. Source:
 * docs/specs/INSTAGRAM-SPEC-FINDINGS.md.
 *
 * The OWNER'S rule is unchanged and is the one that matters — "the photo display in profile will
 * be unified in profile". 3:4 is uniform; it is simply taller. What changes is the number, and the
 * lesson is that I asserted a fact about a live product from memory and was a year out of date.
 *
 * Two surfaces, still deliberately disagreeing: the GRID is 3:4, the FEED takes the post's chosen
 * ratio, and the detail view shows the photograph's true shape. `feedAspect` serves the feed; this
 * serves the grid; nothing consults both.
 */
export const GRID_ASPECT = 3 / 4;

export function cellAspect() {
  return GRID_ASPECT;
}

/**
 * The shape a FEED cell reserves, before the bytes arrive.
 *
 * A chosen ratio wins — that is the author's composition, shown. Original (NULL) has no
 * chosen shape, so fall back to the first media's own ratio from the bytes. When that is
 * null too — video, documents, anything uploaded before dimensions were recorded — return
 * null so the element sizes itself. Never 0: a zero-height box is the failure this repo
 * has already shipped once.
 *
 * The profile grid does not call this. Conflating the two surfaces is what produced the
 * ragged-grid regression in cdda5cb.
 */
export function feedAspect(work) {
  const chosen = ratioAspect(work?.ratio);
  if (typeof chosen === 'number' && chosen > 0) return chosen;
  const fromBytes = work?.media?.[0]?.ratio;
  if (typeof fromBytes === 'number' && fromBytes > 0) return fromBytes;
  return null;
}
