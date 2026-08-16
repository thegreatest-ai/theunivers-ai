/**
 * A place on a work is the author's claim, and nothing more.
 *
 * This repo already has a position system. `shared/assurance.mjs` grades an inspection by
 * comparing the device's own coordinates against an independently resolved position, and
 * its opening doctrine is that `navigator.geolocation` is trivially spoofable. A string
 * typed into a post box is the opposite of that: unverified, unverifiable, and worth
 * exactly the author's word.
 *
 * These helpers exist so create, update, and the three surfaces that render a location
 * cannot drift into treating it as evidence. They parse and they format. They do not
 * geocode, they do not read a device, and they must never be imported by trust, ranking
 * or assurance — an unverified string that moved a tier would be standing bought with
 * a sentence.
 */

import { COUNTRY_CODES } from '../src/app/countries.js';

export { COUNTRY_CODES };

/** Courtesy on the input; the server is the gate. Over this is a 400, never a truncate. */
export const PLACE_MAX = 80;

/**
 * Parse the free-text half.
 *
 * Omitted is missing (CREATE stores NULL; UPDATE leaves the stored value). Empty after
 * trim is NULL — that is how a location is removed. Over PLACE_MAX is an error, never a
 * silent truncate: a caption that stored less than the author typed is a different claim
 * than the one they made.
 */
export function parsePlace(raw) {
  if (raw === undefined) return { missing: true };
  if (raw === null) return { value: null };
  const place = String(raw).trim();
  if (!place) return { value: null };
  if (place.length > PLACE_MAX) return { error: 'place is too long' };
  return { value: place };
}

/**
 * Parse the machine-readable half. Same omitted/empty/NULL shape as parsePlace, so a
 * country alone and a name alone are both locations. An unknown code is an error —
 * including the separator row in countries.js, which is not a country.
 */
export function parsePlaceCc(raw) {
  if (raw === undefined) return { missing: true };
  if (raw === null) return { value: null };
  const cc = String(raw).trim();
  if (!cc) return { value: null };
  if (!COUNTRY_CODES.has(cc)) return { error: 'unknown country' };
  return { value: cc };
}

/**
 * The line a reader sees. Worded as the author's claim because a bare "Jebel Ali, AE"
 * next to a photograph is how a caption becomes evidence in the interface.
 *
 * Returns null when both halves are absent — absent must render as absent, never as
 * an empty row or "Location: —".
 */
export function placeClaim(place, placeCc) {
  const name = place == null ? '' : String(place).trim();
  const cc = placeCc == null ? '' : String(placeCc).trim();
  if (!name && !cc) return null;
  const where = name && cc ? `${name}, ${cc}` : (name || cc);
  return `${where} · added by the author`;
}
