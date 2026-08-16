/**
 * Framing of one image inside the post's frame.
 *
 * work.ratio is the shape of the frame, one per post — already built. Zoom is the opposite:
 * it is per IMAGE, because framing is a judgement about one photograph. A face wants to be
 * closer; a landscape wants room. Instagram splits it in exactly that place, which is why
 * the feature works.
 *
 * This is not a crop of the file. The bytes stay as they were uploaded; cropped surfaces
 * apply `transform: scale()` inside a container that clips, and `object-position` for the
 * focal point. A later change of these numbers loses nothing. The server has no image
 * library and must not gain one for this.
 *
 * 1 and 50/50 mean untouched. Every media row that already exists is already exactly that.
 *
 * ONE module, imported by the server (the gate) and the browser (the courtesy). Two copies
 * would drift, and a silently clamped zoom is a framing the author did not choose.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const ZOOM_DEFAULT = 1;

export const FOCAL_MIN = 0;
export const FOCAL_MAX = 100;
export const FOCAL_DEFAULT = 50;

/** Instagram allows ten. Unlimited plus an add-more button is how a 200-image carousel happens. */
export const MEDIA_CAP = 10;

function parseBounded(raw, { min, max, fallback, name }) {
  if (raw === undefined || raw === null || raw === '') return { value: fallback };
  const n = typeof raw === 'number' ? raw : Number(raw);
  // Out of range is an error, never a clamp — a silently clamped value is a framing the
  // author did not choose, and they cannot tell it happened.
  if (!Number.isFinite(n) || n < min || n > max) {
    return { error: `${name} must be between ${min} and ${max}` };
  }
  return { value: n };
}

/** Omitted is untouched (1). Out of range is `{ error }`, never a clamped number. */
export function parseZoom(raw) {
  return parseBounded(raw, {
    min: ZOOM_MIN, max: ZOOM_MAX, fallback: ZOOM_DEFAULT, name: 'zoom',
  });
}

/** Omitted is centre (50). Out of range is `{ error }`, never a clamped number. */
export function parseFocal(raw, name = 'focal') {
  return parseBounded(raw, {
    min: FOCAL_MIN, max: FOCAL_MAX, fallback: FOCAL_DEFAULT, name,
  });
}

/**
 * CSS for a cropped surface (profile grid, Discover feed, CreatePost preview).
 *
 * Returns undefined when the image is untouched, so 1 / 50/50 apply no extra style — absent
 * stays absent. WorkDetail must not call this: a zoomed detail view would make the original
 * unreachable, which is the one thing this design exists to prevent.
 */
export function cropStyle(media) {
  if (!media) return undefined;
  const zoom = Number(media.zoom);
  const x = Number(media.focal_x);
  const y = Number(media.focal_y);
  const style = {};
  if (Number.isFinite(zoom) && zoom !== ZOOM_DEFAULT) style.transform = `scale(${zoom})`;
  const fx = Number.isFinite(x) ? x : FOCAL_DEFAULT;
  const fy = Number.isFinite(y) ? y : FOCAL_DEFAULT;
  if (fx !== FOCAL_DEFAULT || fy !== FOCAL_DEFAULT) style.objectPosition = `${fx}% ${fy}%`;
  return Object.keys(style).length ? style : undefined;
}
