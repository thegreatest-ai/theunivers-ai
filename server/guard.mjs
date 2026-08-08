/**
 * Pilot adapter — maps SQLite rows into Corridor snapshots and calls the shared guard.
 * Do not re-implement FLOOR / QUANTITY / EXPIRED here. Ever.
 */
import { evaluate } from './vendor/mandate-rules.ts';
import { tierOf } from './trust.mjs';

// The rules are VENDORED from corridor/src/mandate-rules.ts, not reached for across the
// filesystem. The previous '../../../products/corridor/...' worked on one laptop and would have
// failed on first deploy — the Dockerfile in this repo means the pilot is meant to run somewhere
// corridor does not exist.
//
// Corridor remains the single source of truth. `npm test` runs scripts/rules.mjs check, which
// fails if the vendored copy has drifted from it. Do not edit the vendored file.

export function rowToSnapshot(m) {
  if (!m) return null;
  const currency = m.currency || 'INR';
  const floor = m.price_floor != null
    ? (typeof m.price_floor === 'string' ? JSON.parse(m.price_floor) : { amount: Number(m.price_floor), currency })
    : undefined;
  const ceiling = m.price_ceiling != null
    ? (typeof m.price_ceiling === 'string' ? JSON.parse(m.price_ceiling) : { amount: Number(m.price_ceiling), currency })
    : undefined;
  const maxQuantity = m.max_quantity
    ? (typeof m.max_quantity === 'string' ? JSON.parse(m.max_quantity) : m.max_quantity)
    : { value: Number.MAX_SAFE_INTEGER, unit: 't' };
  const consumed = m.consumed
    ? (typeof m.consumed === 'string' ? JSON.parse(m.consumed) : m.consumed)
    : { quantity: 0 };
  const deliveryWindow = m.delivery_window
    ? (typeof m.delivery_window === 'string' ? JSON.parse(m.delivery_window) : m.delivery_window)
    : { from: '1970-01-01', to: '9999-12-31' };

  return {
    scope: m.scope,
    commodity: m.commodity,
    maxQuantity,
    priceFloor: floor?.amount != null ? { amount: Number(floor.amount ?? floor), currency: floor.currency || currency } : undefined,
    priceCeiling: ceiling?.amount != null ? { amount: Number(ceiling.amount ?? ceiling), currency: ceiling.currency || currency } : undefined,
    specTemplateId: m.spec_template_id || 'default',
    deliveryWindow,
    counterpartyMinTier: m.counterparty_min_tier || 'T0',
    expiresAt: m.expires_at || '9999-12-31T00:00:00.000Z',
    status: m.status,
    consumed,
  };
}

export function normalizeIntent(body, counterpartyTier) {
  const kind = String(body.kind ?? 'offer');
  const intent = { kind };

  if (body.commodity) intent.commodity = String(body.commodity);

  // Accept Corridor shape { amount, currency } or legacy pilot number
  if (body.price != null) {
    if (typeof body.price === 'object') {
      intent.price = {
        amount: Number(body.price.amount),
        currency: String(body.price.currency || 'INR'),
      };
    } else {
      intent.price = {
        amount: Number(body.price),
        currency: String(body.currency || 'INR'),
      };
    }
  }

  if (body.quantity) {
    intent.quantity = {
      value: Number(body.quantity.value ?? body.quantity),
      unit: String(body.quantity.unit || 't'),
    };
  }

  if (body.specTemplateId) intent.specTemplateId = String(body.specTemplateId);
  if (body.deliveryDate) intent.deliveryDate = String(body.deliveryDate);

  // Counterparty tier is supplied by the CALLER as an argument — never read from `body`.
  //
  // This previously read: "caller may pass resolved tier, or we leave undefined (skip tier
  // check)", and the HTTP layer never passed one. So COUNTERPARTY_TIER was inert in production
  // while its test passed, because the test supplied a tier. A refusal that only fires in tests
  // is worse than no refusal at all: it reads as covered.
  //
  // Taking it from `body` would be worse still — a counterparty could assert their own standing
  // by putting it in the JSON. Hence an argument, and hence resolveTier() below, which derives
  // it from anchors and receipts.
  if (counterpartyTier !== undefined) intent.counterpartyTier = counterpartyTier;

  return intent;
}

/**
 * @param mandateRows  the principal's mandates
 * @param intentBody   what the agent wants to do
 * @param opts.counterpartyTier  RESOLVED tier. Callers use resolveTier() — never request input.
 */
export function checkMandates(mandateRows, intentBody, opts = {}, now = new Date()) {
  const snapshots = (Array.isArray(mandateRows) ? mandateRows : [mandateRows])
    .map(rowToSnapshot)
    .filter(Boolean);
  const intent = normalizeIntent(intentBody, opts.counterpartyTier);
  return evaluate(snapshots, intent, now);
}

/**
 * Derive a counterparty's standing from their anchors and receipts. Returns undefined when there
 * is no counterparty to resolve, which correctly skips the tier rule rather than failing open on
 * a fabricated value.
 */
export function resolveTier(counterpartyUserId, now = new Date()) {
  return counterpartyUserId ? tierOf(String(counterpartyUserId), now) : undefined;
}
