/**
 * Assurance — how much an inspection's evidence is worth, graded rather than asserted.
 *
 * ─── Why a grade and not a boolean ─────────────────────────────────────────────────────────
 *
 * `navigator.geolocation` is trivially spoofable — DevTools sensors, a browser extension,
 * Android's mock-location developer option. Setting Chrome's sensor override to a Houston
 * coordinate makes any page believe you are in Houston. A platform that treats that number as
 * proof makes its most valuable artefact its easiest forgery.
 *
 * So the check is NOT "where are you". It is CONSISTENCY between two signals that cost different
 * amounts to forge — the device's own geolocation and an independent network-derived position.
 * Any one signal is forgeable; disagreement between them is informative. See
 * docs/specs/ORDER-AND-INSPECTION.md.
 *
 * Shared with the browser for the same reason `order-states.mjs` is: the capture screen grades
 * as it collects so it can tell the inspector what level they are about to submit, and a second
 * copy of that arithmetic would drift from the server's — and the server's is the one that counts,
 * because the browser's is advisory and re-scored server-side on submission.
 * ───────────────────────────────────────────────────────────────────────────────────────────
 */

/**
 * The levels, weakest to strongest. Ordered, because a buyer sets a MINIMUM ("web-attested or
 * better") the same way `counterparty_min_tier` lets them demand standing, so the levels must
 * compare.
 *
 *   self            a photo, no location. Costs least, proves least.
 *   web-attested    a live frame, a platform nonce in shot, and device + network position that
 *                   AGREE, captured at a moment the platform chose. Costs more.
 *   device-attested a native app with Play Integrity / App Attest and OS mock-location detection.
 *                   Costs most, and is out of scope until a native app exists — the tier exists in
 *                   the schema so later inspections are DISTINGUISHABLE from earlier ones rather
 *                   than silently equated.
 */
export const LEVELS = ['self', 'web-attested', 'device-attested'];

export const rank = (level) => {
  const i = LEVELS.indexOf(level);
  return i < 0 ? -1 : i;
};

/** Does `have` satisfy a policy that demands at least `min`? */
export function meets(have, min) {
  const h = rank(have);
  const m = rank(min);
  return h >= 0 && m >= 0 && h >= m;
}

/**
 * How far apart two lat/lng points are, in kilometres. Haversine — good enough for "same emirate
 * or not", which is the only question asked of it. Not used for anything that needs sub-km
 * accuracy, and there is nothing here that does.
 */
export function haversineKm(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The largest emirate spans well under this; two independent fixes for the same person at the same
 * moment should land inside it. Wider than GPS error, narrower than "a different city", because
 * the claim being tested is "these two signals describe the same place", not "these two signals
 * are the same point". Network geolocation is coarse by nature — it resolves to a city, not a
 * doorway — so demanding tighter agreement would fail honest captures and teach nobody anything.
 */
export const CONSISTENCY_RADIUS_KM = 75;

/**
 * The window the platform gives an inspector to respond to an UNANNOUNCED location request. Faking
 * a fix you did not know would be asked for is materially harder than faking a scheduled one, and
 * that difficulty is the whole point — so a response that arrives long after the request is worth
 * less, because it had time to be manufactured. Not a hard reject: a slow response can be honest
 * on a bad connection. It lowers the grade rather than voiding it, and the receipt records the
 * delay so a human can weigh it.
 */
export const RESPONSE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Grade one capture. Returns the LEVEL and the reasons, because a grade with no reasons is the
 * same unaccountable badge this whole design refuses — the inspector, the parties and any later
 * arbiter must be able to see WHY it landed where it did.
 *
 * This is deliberately conservative: any missing or inconsistent signal drops the grade rather
 * than being waved through. Over-crediting evidence is the worst failure for a product whose
 * thesis is receipts you can trust.
 *
 * @param capture.live        the frame came from a media stream, not a file picker
 * @param capture.nonce       the per-check-in code was present in the submission
 * @param capture.nonceInShot the code was legible IN the frame (a human/OCR check, passed in)
 * @param capture.device      { lat, lng, accuracy_m } from navigator.geolocation
 * @param capture.network     { lat, lng } derived server-side from the request, independent of the
 *                            device's own claim
 * @param capture.requestedAt when the platform ASKED for the fix
 * @param capture.observedAt  when the device REPORTED it
 */
export function grade(capture = {}) {
  const reasons = [];
  const {
    live, nonce, nonceInShot, device, network, requestedAt, observedAt,
  } = capture;

  // self is the floor: a photo and nothing that ties it to a place or a moment. Everything below
  // fails UP from here only when it can prove more.
  if (!live) {
    reasons.push('capture was not live — a file, not a frame from the camera now');
    return { level: 'self', reasons, consistent: false };
  }
  reasons.push('capture was live');

  if (!nonce || !nonceInShot) {
    reasons.push('platform nonce absent or not visible in the frame');
    return { level: 'self', reasons, consistent: false };
  }
  reasons.push('platform nonce present and visible in the frame');

  if (!device || !network || device.lat == null || network.lat == null) {
    reasons.push('missing device or network position — cannot check consistency');
    return { level: 'self', reasons, consistent: false };
  }

  const km = haversineKm(
    { lat: Number(device.lat), lng: Number(device.lng) },
    { lat: Number(network.lat), lng: Number(network.lng) },
  );
  const consistent = km <= CONSISTENCY_RADIUS_KM;
  if (!consistent) {
    reasons.push(
      `device and network positions disagree by ${km.toFixed(0)}km (limit ${CONSISTENCY_RADIUS_KM}km)`);
    // Inconsistency is the signal we built the whole grade around. It does not merely fail to
    // upgrade — it is affirmative evidence that one signal is forged, so it caps at self and says
    // why.
    return { level: 'self', reasons, consistent: false };
  }
  reasons.push(`device and network positions agree to within ${km.toFixed(0)}km`);

  if (requestedAt != null && observedAt != null) {
    const delay = new Date(observedAt).getTime() - new Date(requestedAt).getTime();
    if (Number.isFinite(delay) && delay > RESPONSE_WINDOW_MS) {
      reasons.push(
        `response arrived ${Math.round(delay / 60000)}min after the request (window `
        + `${RESPONSE_WINDOW_MS / 60000}min) — recorded, not rejected`);
      // Late but consistent: still web-attested, with the delay on the record for a human to weigh.
      // We do not silently downgrade, because the honest explanation (a bad connection) and the
      // dishonest one (time to fabricate) produce the same number, and only a human can tell them
      // apart. The receipt carries the fact; the grade does not pretend to have judged it.
    } else if (Number.isFinite(delay)) {
      reasons.push(`response arrived within the ${RESPONSE_WINDOW_MS / 60000}min window`);
    }
  }

  // device-attested is unreachable from a browser by construction: it needs attestation the web
  // cannot provide. The strongest a web capture earns is web-attested, and claiming more would be
  // the overclaiming this design refuses everywhere else.
  return { level: 'web-attested', reasons, consistent: true };
}
