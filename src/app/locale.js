/**
 * Locale — currency and language, per viewer.
 *
 * ─── The rule this file exists to protect ────────────────────────────────────────────────
 *
 *   DISPLAY converts. ENFORCEMENT never does.
 *
 * A mandate floor is enforced in the currency it was SIGNED in, always. If a floor of ₹18/kg
 * were enforced after conversion to AED, an FX move would raise or lower a farmer's floor
 * without him agreeing to anything — his agent would start accepting deals he refused last
 * week, and the receipt would say he consented. That is a silent breach of the one promise
 * the product makes.
 *
 * So: `convert()` is for rendering. Nothing in the guard path may call it. The signed value is
 * shown alongside every converted one (`fmtDual`) so the number that binds is never hidden
 * behind the number that is convenient.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

/**
 * Indicative rates, for display only. In production these come from a dated feed and every
 * receipt records the rate and timestamp used — otherwise a converted figure on an old receipt
 * silently changes meaning as the market moves.
 */
export const RATES = { INR: 1, AED: 0.0441, USD: 0.0120 };  // per 1 INR, indicative
const SYMBOL = { INR: '₹', AED: 'AED ', USD: '$' };

export const LOCALES = {
  'hi-IN': { label: 'हिन्दी',  currency: 'INR', dir: 'ltr' },
  'en-IN': { label: 'English (IN)', currency: 'INR', dir: 'ltr' },
  'en-AE': { label: 'English (AE)', currency: 'AED', dir: 'ltr' },
};

/** Display conversion only. Never call this from anything that decides an outcome. */
export function convert(amount, from, to) {
  if (from === to) return amount;
  const inInr = amount / RATES[from];
  return inInr * RATES[to];
}

export function fmt(amount, currency) {
  const dp = currency === 'INR' ? (amount < 100 ? 2 : 0) : 2;
  return `${SYMBOL[currency]}${amount.toLocaleString(undefined, {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  })}`;
}

/**
 * The signed figure first, the viewer's currency second and marked approximate.
 * A converted number must never be able to pass as the agreed one.
 */
export function fmtDual(money, viewerCurrency) {
  const signed = fmt(money.amount, money.currency);
  if (money.currency === viewerCurrency) return { signed, approx: null };
  return { signed, approx: `≈ ${fmt(convert(money.amount, money.currency, viewerCurrency), viewerCurrency)}` };
}

/** UI strings. Hindi is first-class here, not an afterthought bolted on for a demo. */
const STRINGS = {
  'hi-IN': {
    you: 'आप', yourAgent: 'आपका एजेंट', space: 'बाज़ार',
    agentAsking: 'आपका एजेंट पूछ रहा है',
    approve: 'स्वीकार करें', hold: 'रोकें',
    yourMandate: 'आपका अधिकार-पत्र', commodity: 'वस्तु', priceFloor: 'न्यूनतम मूल्य',
    scope: 'दायरा', minTier: 'न्यूनतम श्रेणी', editMandate: 'अधिकार-पत्र बदलें',
    standing: 'साख', derived: 'गणना से, दी हुई नहीं', delivered: 'पूर्ण किए गए सौदे',
    pause: 'रोकें', receipts: 'रसीदें', signedOn: 'हस्ताक्षर',
    floorNote: 'आपका एजेंट इस न्यूनतम मूल्य से नीचे नहीं जा सकता, खरीदार चाहे कुछ भी कहे। यह सीमा कोड में लागू है, एजेंट की समझ पर नहीं।',
    typedOnly: 'एजेंट क्या प्रकाशित कर रहे हैं। केवल निर्धारित प्रकार की पोस्ट — हर एक असली सूची या रसीद से जुड़ी।',
    signedIn: 'हस्ताक्षरित मूल्य',
  },
  'en-IN': null,   // falls through to English
  'en-AE': null,
};

const EN = {
  you: 'You', yourAgent: 'Your agent', space: 'Space',
  agentAsking: 'Your agent is asking',
  approve: 'Approve', hold: 'Hold',
  yourMandate: 'Your mandate', commodity: 'Commodity', priceFloor: 'Price floor',
  scope: 'Scope', minTier: 'Counterparty minimum', editMandate: 'Edit mandate',
  standing: 'Standing', derived: 'derived, not granted', delivered: 'Delivered',
  pause: 'Pause', receipts: 'Receipts', signedOn: 'Signed',
  floorNote: 'Your agent cannot go below the floor, whatever a buyer says to it. That limit is enforced in code, not in the model’s judgement.',
  // "Agent to agent" moved to Messages, where two agents actually talk to each other. On the feed
  // it now described the wrong thing: a post is an agent publishing, not an agent negotiating.
  typedOnly: 'What agents are publishing. Typed posts only — every one points at a real listing or receipt.',
  signedIn: 'signed',
};

export const t = (locale) => ({ ...EN, ...(STRINGS[locale] || {}) });
