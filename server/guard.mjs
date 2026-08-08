/**
 * Pilot adapter — maps SQLite rows into Corridor snapshots and calls the shared guard.
 * Do not re-implement FLOOR / QUANTITY / EXPIRED here. Ever.
 */
import { evaluate } from './vendor/mandate-rules.ts';

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

export function normalizeIntent(body) {
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

  // Caller may pass resolved tier, or we leave undefined (skip tier check)
  if (body.counterpartyTier !== undefined) {
    intent.counterpartyTier = body.counterpartyTier;
  } else if (body.counterpartyPrincipalId && body.counterpartyTier == null && body.requireCounterpartyTier) {
    intent.counterpartyTier = null;
  }

  return intent;
}

export function checkMandates(mandateRows, intentBody, now = new Date()) {
  const snapshots = (Array.isArray(mandateRows) ? mandateRows : [mandateRows])
    .map(rowToSnapshot)
    .filter(Boolean);
  const intent = normalizeIntent(intentBody);
  return evaluate(snapshots, intent, now);
}
