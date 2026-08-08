// GENERATED — do not edit. Source of truth: corridor/src/mandate-rules.ts
// Regenerate with: node scripts/rules.mjs sync
/**
 * Pure mandate evaluation — the ONLY place refusal rules live.
 *
 * Corridor's check() loads mandates/trust from its DB then calls evaluate().
 * theunivers pilot maps its rows into the same shapes and calls evaluate().
 * One enforcement site. No second copy of FLOOR / QUANTITY / EXPIRED / …
 */

export type MandateScope = 'quote' | 'negotiate' | 'commit';
export type TrustTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

export type Money = { amount: number; currency: string };
export type Quantity = { value: number; unit: string };

export interface MandateSnapshot {
  scope: MandateScope;
  commodity: string;
  maxQuantity: Quantity;
  priceFloor?: Money;
  priceCeiling?: Money;
  specTemplateId: string;
  deliveryWindow: { from: string; to: string };
  counterpartyMinTier: TrustTier;
  expiresAt: string;
  status: 'active' | 'exhausted' | 'revoked' | 'expired';
  consumed: { quantity: number };
}

export interface IntentSnapshot {
  kind: 'quote' | 'offer' | 'counter' | 'accept' | 'post' | 'message';
  commodity?: string;
  quantity?: Quantity;
  price?: Money;
  specTemplateId?: string;
  deliveryDate?: string;
  /** Pre-resolved tier of the counterparty. Caller loads trust; rules stay pure. */
  counterpartyTier?: TrustTier | null;
}

export type GuardResult = { ok: true } | { ok: false; reason: string; code: string };

const SCOPE_RANK: Record<MandateScope, number> = { quote: 1, negotiate: 2, commit: 3 };
const INTENT_SCOPE: Record<IntentSnapshot['kind'], MandateScope> = {
  post: 'quote',
  message: 'quote',
  quote: 'quote',
  offer: 'negotiate',
  counter: 'negotiate',
  accept: 'commit',
};

const TIER_ORDER: TrustTier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];

function tierAtLeast(actual: TrustTier, required: TrustTier): boolean {
  return TIER_ORDER.indexOf(actual) >= TIER_ORDER.indexOf(required);
}

/**
 * Evaluate one mandate against one intent.
 * Returns null if this mandate does not match (caller tries the next);
 * returns GuardResult when the mandate decides allow/deny.
 */
export function evaluateOne(
  m: MandateSnapshot,
  intent: IntentSnapshot,
  now: Date = new Date(),
): GuardResult | 'skip' {
  if (m.status !== 'active') return 'skip';
  if (new Date(m.expiresAt) <= now) {
    return { ok: false, reason: 'mandate expired', code: 'EXPIRED' };
  }

  const needed = INTENT_SCOPE[intent.kind] ?? 'negotiate';
  if (SCOPE_RANK[needed] > SCOPE_RANK[m.scope]) {
    return {
      ok: false,
      reason: `intent needs '${needed}' authority, mandate grants '${m.scope}'`,
      code: 'SCOPE',
    };
  }
  if (intent.commodity && intent.commodity !== m.commodity) {
    return { ok: false, reason: 'commodity mismatch', code: 'COMMODITY' };
  }
  if (intent.specTemplateId && intent.specTemplateId !== m.specTemplateId) {
    return { ok: false, reason: 'spec template mismatch', code: 'SPEC' };
  }
  if (intent.quantity) {
    const remaining = m.maxQuantity.value - m.consumed.quantity;
    if (intent.quantity.unit !== m.maxQuantity.unit) {
      return { ok: false, reason: 'quantity unit mismatch', code: 'UNIT' };
    }
    if (intent.quantity.value > remaining) {
      return {
        ok: false,
        reason: `quantity ${intent.quantity.value} exceeds remaining ${remaining}`,
        code: 'QUANTITY',
      };
    }
  }
  if (intent.price) {
    if (
      m.priceFloor &&
      intent.price.currency === m.priceFloor.currency &&
      intent.price.amount < m.priceFloor.amount
    ) {
      return {
        ok: false,
        reason: `price ${intent.price.amount} below floor ${m.priceFloor.amount}`,
        code: 'FLOOR',
      };
    }
    if (
      m.priceCeiling &&
      intent.price.currency === m.priceCeiling.currency &&
      intent.price.amount > m.priceCeiling.amount
    ) {
      return {
        ok: false,
        reason: `price ${intent.price.amount} above ceiling ${m.priceCeiling.amount}`,
        code: 'CEILING',
      };
    }
  }
  if (intent.deliveryDate) {
    const d = new Date(intent.deliveryDate);
    if (d < new Date(m.deliveryWindow.from) || d > new Date(m.deliveryWindow.to)) {
      return { ok: false, reason: 'delivery date outside window', code: 'WINDOW' };
    }
  }
  if (intent.counterpartyTier !== undefined) {
    // Explicit null = unknown / missing trust → refuse
    if (
      intent.counterpartyTier == null ||
      !tierAtLeast(intent.counterpartyTier, m.counterpartyMinTier)
    ) {
      return {
        ok: false,
        reason: `counterparty below required tier ${m.counterpartyMinTier}`,
        code: 'COUNTERPARTY_TIER',
      };
    }
  }

  return { ok: true };
}

/**
 * Try active mandates in order. Same semantics as Corridor's check() loop.
 */
export function evaluate(
  mandates: MandateSnapshot[],
  intent: IntentSnapshot,
  now: Date = new Date(),
): GuardResult {
  if (mandates.length === 0) {
    return { ok: false, reason: 'no active mandate', code: 'NO_MANDATE' };
  }

  let lastReason = 'no mandate matched this intent';
  let lastCode = 'NO_MATCH';

  for (const m of mandates) {
    const result = evaluateOne(m, intent, now);
    if (result === 'skip') continue;
    if (result.ok) return result;
    // Soft mismatches (commodity etc.) continue to next mandate; keep last denial.
    lastReason = result.reason;
    lastCode = result.code;
    // FLOOR/CEILING/QUANTITY/SCOPE on a matching commodity should stick if only one mandate —
    // Corridor continues on mismatch codes that are "try next". Mirror Corridor: always continue
    // until a mandate returns ok, else last denial.
  }

  return { ok: false, reason: lastReason, code: lastCode };
}
