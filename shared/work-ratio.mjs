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
];

/** CSS aspect-ratio number for a chosen presentation id. Original has none of its own. */
export function ratioAspect(id) {
  if (id === '1:1') return 1;
  if (id === '4:5') return 4 / 5;
  if (id === '16:9') return 16 / 9;
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
  if (raw === '1:1' || raw === '4:5' || raw === '16:9') return { value: raw };
  return { error: 'unknown ratio' };
}

/**
 * THE PROFILE GRID IS ALWAYS SQUARE. It does not read work.ratio, and that is the point.
 *
 * The brief this was built from said "absent must render as the true shape", and that was
 * wrong — it let every existing work (all of them NULL) fall back to its own shape and put
 * the ragged grid straight back. The owner's instruction is the authority and it is one
 * sentence: **"the photo display in profile will be unified in profile"**, later shortened
 * to "fix the grid & keep the original detail". A grid that reserves each cell differently
 * is not unified, whether the difference comes from the file or from a chosen ratio.
 *
 * It is also what Instagram does, which is easy to misremember: the profile grid is square
 * for every post regardless of the ratio it was published at. The chosen ratio governs the
 * FEED. Those are two different surfaces and conflating them is what produced the bug.
 *
 * A constant rather than a computed value, so there is nothing here to drift. `feedAspect`
 * is what Discover uses; this function exists so a test can pin the grid without reading CSS.
 */
export const GRID_ASPECT = 1;

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
