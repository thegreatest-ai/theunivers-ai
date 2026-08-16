/**
 * Reverse geocoding — coordinates in, a place name out, nothing stored.
 *
 * ─── Why this is a server module rather than a browser call ────────────────────────────────
 *
 * `navigator.geolocation` returns a lat/lng. A reader needs a name, and a name needs a
 * geocoder. The CSP allows no external hosts, so the page cannot ask one. The browser
 * sends coordinates to US; we ask the geocoder; we return a name. The page still only
 * talks to its own origin, we own the rate limit and the cache, and the third party is
 * swappable in this file — the same shape as `storage.mjs`, and for the same reason.
 *
 * The coordinates live for the duration of one HTTP request. They are not written to
 * `work`. A raw lat/lng on a public post is precise enough to be someone's front door,
 * and once published it cannot be recalled. Instagram publishes a place, not a fix.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Today: OpenStreetMap Nominatim. Their usage policy is binding and unmetered use gets
 * blocked — identifying User-Agent, and at most one request per second process-wide.
 * Cache key is coordinates rounded to 3 decimals (~110m): a person standing still does
 * not re-ask, and we never needed the extra precision we are about to throw away.
 */
import { parsePlace, parsePlaceCc } from '../shared/place.mjs';

const ENDPOINT = process.env.GEOCODE_URL ?? 'https://nominatim.openstreetmap.org/reverse';

/*
 * Nominatim's 1/s is binding in production. Tests set GEOCODE_MIN_INTERVAL_MS=0 so a
 * suite that resolves two cities does not sleep a second between them — the policy is
 * not a test of our clock.
 */
const MIN_INTERVAL_MS = Number(process.env.GEOCODE_MIN_INTERVAL_MS ?? 1000);

const UA = 'theunivers.ai/0.1 (+https://theunivers.ai)';

/**
 * Address parts that name a PLACE, not a door.
 *
 * `road` / `house_number` / `postcode` / `display_name` are deliberately absent: those
 * are the front-door precision this whole design exists to throw away. A suburb or a
 * city is what a caption is for.
 */
const PLACE_PARTS = [
  'neighbourhood', 'suburb', 'city_district', 'quarter',
  'hamlet', 'village', 'town', 'city', 'municipality',
  'county', 'state',
];

const cache = new Map();

let lastAt = 0;
let queue = Promise.resolve();

function cacheKey(lat, lng) {
  return `${Math.round(Number(lat) * 1000) / 1000},${Math.round(Number(lng) * 1000) / 1000}`;
}

function serialise(fn) {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastAt = Date.now();
    }
  });
  // A rejected lookup must not stall every later one.
  queue = run.then(() => {}, () => {});
  return run;
}

/**
 * Pick a short name and an alpha-2 code from a Nominatim (or Nominatim-shaped) payload.
 *
 * Validated against the same `parsePlace` / `parsePlaceCc` the typed field uses, so a
 * geocoder cannot produce something `POST /api/works` would have refused. Unknown
 * country → name with no code, which is already a location. Over-long part → try the
 * next, never truncate: a caption that stored less than the geocoder said is a
 * different claim than the one it made.
 *
 * Returns `{ place: null }` when nothing usable is in the payload — including a raw
 * street address with no area name, which we refuse on purpose.
 */
export function nameFrom(payload) {
  if (!payload || payload.error || typeof payload !== 'object') return { place: null };
  const address = payload.address && typeof payload.address === 'object' ? payload.address : {};

  let place = null;
  for (const key of PLACE_PARTS) {
    const parsed = parsePlace(address[key]);
    if (parsed.value) { place = parsed.value; break; }
  }
  if (!place) {
    // jsonv2's `name` is the matched object's name — useful when address parts are
    // empty, but only if it is not the country (that belongs in place_cc) and only
    // if it parses. Still never display_name: that is the full address.
    const fallback = parsePlace(payload.name);
    const countryName = String(address.country ?? '').trim();
    if (fallback.value && fallback.value !== countryName) place = fallback.value;
  }
  if (!place) return { place: null };

  const ccRaw = address.country_code == null ? '' : String(address.country_code).trim().toUpperCase();
  const coded = parsePlaceCc(ccRaw);
  return { place, place_cc: coded.value ?? null };
}

async function askProvider(lat, lng) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  // 14 is neighbourhood / suburb. Tighter zoom returns a building, which is the
  // precision we are about to discard, so there is no reason to ask for it.
  url.searchParams.set('zoom', '14');

  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: 'application/json',
      referer: 'https://theunivers.ai/',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/**
 * Resolve coordinates to `{ place, place_cc }` or `{ place: null }`.
 *
 * Never throws: a geocoder being down is not the author's error, and the typed
 * field still works. Never returns the raw provider payload — it carries a full
 * address.
 */
export async function reverse(lat, lng) {
  const key = cacheKey(lat, lng);
  if (cache.has(key)) return cache.get(key);
  try {
    const raw = await serialise(() => askProvider(lat, lng));
    const named = nameFrom(raw);
    if (named.place) cache.set(key, named);
    return named;
  } catch {
    return { place: null };
  }
}
