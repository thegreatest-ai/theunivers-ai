// GENERATED — do not edit. Source of truth: corridor/src/trust-rules.ts
// Regenerate with: node scripts/rules.mjs sync
/**
 * Pure trust derivation — the ONLY place tier and score are computed.
 *
 * Extracted from trust.ts for the same reason mandate-rules.ts was extracted from mandate.ts:
 * the theunivers pilot needs the identical computation, and a second implementation would drift.
 * The last time two copies of a rule existed they disagreed within two days, and the difference
 * only showed up because someone diffed them.
 *
 * Corridor's trust.ts loads anchors and receipts from its DB and calls derive().
 * The pilot maps its SQLite rows into the same shapes and calls derive().
 * One derivation site. No second copy of ANCHOR_STRENGTH or the tier ladder.
 *
 * Nothing in this file touches a database, a clock, or the network — `now` is passed in — so it
 * is trivially testable and cannot acquire a hidden dependency later.
 *
 * INVARIANT 1: tier is DERIVED, never granted. There is no write path here and there must never
 * be one. The moment tier becomes a field somebody can set, this is a directory with badges.
 */

export type TrustTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';
export type AnchorMethod = 'api' | 'document' | 'vouch' | 'onsite';

/** How much a verified anchor is worth. Scarcity in the world, not in the system. */
export const ANCHOR_STRENGTH: Record<string, number> = {
  trade_licence: 1.0,     // strongest single anchor: expensive, revocable, tied to a person
  onsite_visit: 1.0,
  uae_pass: 0.9,
  factory_licence: 0.85,
  iec: 0.6,
  gstin: 0.6,
  vat_trn: 0.6,
  udyam: 0.5,
  chamber_membership: 0.5,
  mandi_licence: 0.5,
  farmer_id: 0.5,
  fpo_membership: 0.5,    // variable in practice — inherits from the voucher
};

const HIGH = 0.8;
const TIER_ORDER: TrustTier[] = ['T0', 'T1', 'T2', 'T3', 'T4'];

export function tierAtLeast(actual: TrustTier, required: TrustTier): boolean {
  return TIER_ORDER.indexOf(actual) >= TIER_ORDER.indexOf(required);
}

/** Only what the maths needs. Callers map their own rows into this. */
export interface AnchorSnapshot {
  type: string;
  method: AnchorMethod;
  status: string;
  verifiedAt?: string | null;
  expiresAt?: string | null;
}

export interface Performance {
  completed: number;
  specMet: number;
  disputes: number;
  inspectionsPassed: number;
}

export interface TrustResult {
  tier: TrustTier;
  score: number;                        // 0..100 — ranking only, never a gate
  components: Record<string, number>;
  explanation: string[];
}

/** An anchor counts only while it is verified and unexpired. Expiry is not cosmetic:
 *  a lapsed trade licence is exactly the case where standing should fall. */
export function liveAnchors(anchors: AnchorSnapshot[], now: Date): AnchorSnapshot[] {
  return anchors.filter(a =>
    a.status === 'verified' && (!a.expiresAt || new Date(a.expiresAt) > now));
}

/** Count receipt types into the performance figures the tier ladder reads. */
export function performanceFrom(receiptTypes: string[]): Performance {
  return {
    completed: receiptTypes.filter(t => t === 'payment.released').length,
    specMet: receiptTypes.filter(t => t === 'inspection.passed').length,
    disputes: receiptTypes.filter(t => t === 'dispute.opened').length,
    inspectionsPassed: receiptTypes.filter(t => t === 'inspection.passed').length,
  };
}

export function deriveTier(
  anchors: AnchorSnapshot[], perf: Performance, hasOnsite: boolean, ageDays: number,
): TrustTier {
  if (anchors.length === 0) return 'T0';

  const strengths = anchors.map(a => ANCHOR_STRENGTH[a.type] ?? 0.3);
  const highCount = strengths.filter(s => s >= HIGH).length;
  const mediumCount = strengths.filter(s => s >= 0.4 && s < HIGH).length;
  const vouched = anchors.some(a => a.method === 'vouch');

  // T2 — transactable. A high anchor, two mediums, or a vouch from someone with
  // something to lose. This is the line the unregistered supplier has to cross.
  const transactable = highCount >= 1 || mediumCount >= 2 || vouched;
  if (!transactable) return 'T1';

  const clean = perf.completed >= 5 && perf.inspectionsPassed >= 1 && perf.disputes === 0;
  if (!clean) return 'T2';

  // T4 confers the right to vouch — i.e. to mint transactable identity for someone
  // else. Handing that out cheaply recreates the Sybil problem one level up.
  if (hasOnsite && ageDays >= 365 && perf.disputes === 0) return 'T4';
  return 'T3';
}

/**
 * The whole derivation. Callers supply already-loaded anchors, receipt types and account age;
 * this returns tier, score and the explanation, and touches nothing else.
 */
export function derive(
  anchors: AnchorSnapshot[], receiptTypes: string[], ageDays: number, now: Date = new Date(),
): TrustResult {
  const live = liveAnchors(anchors, now);
  const perf = performanceFrom(receiptTypes);
  const hasOnsite = live.some(a => a.type === 'onsite_visit');
  const tier = deriveTier(live, perf, hasOnsite, ageDays);

  const anchorStrength = live.length
    ? Math.max(...live.map(a => ANCHOR_STRENGTH[a.type] ?? 0.3))
    : 0;

  // Rate-based, not count-based: a 400-deal trader with 12% disputes should rank
  // below a 20-deal FPO with none.
  const total = perf.completed + perf.disputes;
  const performanceHistory = total === 0
    ? 0.3                                        // unproven, not bad
    : Math.max(0, (perf.completed - perf.disputes * 3) / total);

  const responsiveness = 0.5;                    // placeholder until real timings exist
  const vouchStanding = live.some(a => a.method === 'vouch') ? 0.6 : 0.5;
  const recency = Math.max(0, 1 - ageDays / 730);

  const components = { anchorStrength, performanceHistory, responsiveness, vouchStanding, recency };

  const score = Math.round(100 * (
    0.35 * anchorStrength +
    0.30 * performanceHistory +
    0.15 * responsiveness +
    0.10 * vouchStanding +
    0.10 * recency
  ));

  // Explanations are localisable keys, not debug output. A score that cannot be
  // explained cannot be appealed — and an unappealable score is a badge.
  const explanation: string[] = [];
  explanation.push(live.length
    ? `trust.explain.anchors|${live.length}|${live.map(a => a.type).join(',')}`
    : 'trust.explain.no_anchors');
  if (perf.completed > 0) explanation.push(`trust.explain.completed|${perf.completed}`);
  if (perf.disputes > 0) explanation.push(`trust.explain.disputes|${perf.disputes}`);
  if (tier === 'T2') explanation.push('trust.explain.next_t3');
  if (tier === 'T1') explanation.push('trust.explain.next_t2');

  return { tier, score, components, explanation };
}
