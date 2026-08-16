/**
 * Presentation ratios a work may take.
 *
 * One per POST, never per image — a carousel whose slides disagree about shape makes the
 * viewer's frame jump on every swipe. NULL in the database is Original: the photograph's
 * own shape. Every work that already exists is already NULL, which is the honest default,
 * and for documents and threads it is the only sensible answer.
 *
 * This is not a crop of the file. The bytes stay as they were uploaded; the grid cell uses
 * `aspect-ratio` + `object-fit: cover`. A later change of this value loses nothing, which
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
 * The aspect the GRID cell should hold. A chosen work.ratio wins, so every slide of a
 * carousel presents at the post's shape rather than its own. Original (null) falls back
 * to the first image's true shape from the bytes. Absent stays absent — never zero.
 */
export function cellAspect(work) {
  const chosen = work?.ratio;
  if (chosen && chosen !== 'original') {
    const n = ratioAspect(chosen);
    if (typeof n === 'number' && n > 0) return n;
  }
  const r = work?.media?.[0]?.ratio;
  if (typeof r === 'number' && r > 0) return r;
  return undefined;
}
