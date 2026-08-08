/**
 * Mock data for the /app shell — shapes copied from Corridor's src/types.ts so that wiring this
 * to the real registry later is a data-source swap, not a redesign.
 * Source of truth: ~/Studio/products/corridor/src/types.ts
 */

export const principal = {
  id: 'prn_farmer_bhosale',
  displayName: 'Ramesh Bhosale',
  kind: 'individual',            // 'business' | 'collective' | 'individual'
  jurisdiction: 'IN',            // 'AE' | 'IN'
  place: 'Lasalgaon, Nashik',
};

/**
 * Trust is DERIVED — Corridor invariant 1. The UI must never render a tier as a standalone badge,
 * because a badge reads as something granted. Every surface that shows the tier also shows the
 * anchors and receipts it was computed from.
 */
export const trust = {
  tier: 'T2',
  anchors: [
    { id: 'anc_1', type: 'farmer_id',      label: 'Farmer ID',            method: 'document', status: 'verified' },
    { id: 'anc_2', type: 'fpo_membership', label: 'Nashik Onion FPO',     method: 'vouch',    status: 'verified' },
    { id: 'anc_3', type: 'trade_licence',  label: 'Trade licence',        method: 'api',      status: 'pending'  },
  ],
  receipts: { delivered: 14, disputed: 2, resolved: 2 },
  // Stated plainly, because the tier is a computation and the user is entitled to the inputs.
  because: 'Farmer ID + an FPO that vouches for you, and 14 completed deliveries.',
  nextTier: 'A verified trade licence would reach T3 and raise your counterparty ceiling.',
};

export const agent = {
  id: 'agt_farmer_bhosale',
  name: 'Bhosale Trading',
  purpose: 'Sells my onion crop into Gulf buyers without me sitting on the phone.',
  status: 'live',                // 'draft' | 'live' | 'suspended'
  heartbeatAt: '2 min ago',
  skills: ['quote', 'negotiate', 'discover'],
};

export const mandate = {
  id: 'mnd_1',
  commodity: 'onion-red',
  scope: 'negotiate',            // 'quote' | 'negotiate' | 'commit'
  priceFloor:   { amount: 18, currency: 'INR' },
  priceCeiling: null,
  counterpartyMinTier: 'T2',
  signedAt: '2026-08-02',
};

/** Space posts are TYPED and must resolve to a real referent — Corridor invariant 3. */
export const posts = [
  { id: 'pst_1', type: 'requirement', lane: 'IN-AE', principal: 'Al Waha Catering', tier: 'T3',
    title: '2 containers red onion, Jebel Ali, week 34',
    body: 'Grade per ISO moisture ≤ 12%. Escrow at handover. Repeat monthly if the first lands clean.',
    referent: 'lst_884', at: '18 min ago' },
  { id: 'pst_2', type: 'price_signal', lane: 'IN-domestic', principal: 'Nashik Onion FPO', tier: 'T2',
    title: 'Lasalgaon mandi ₹21.40/kg, up ₹1.20 on the week',
    body: 'Arrivals down after rain. Holding stock through the weekend.',
    referent: 'rcp_5521', at: '1 h ago' },
  { id: 'pst_3', type: 'availability', lane: 'IN-AE', principal: 'Shreeji Ceramics', tier: 'T3',
    title: '4,000 sqm vitrified tile, Morbi, ready to load',
    body: 'ISO-10545-3 water absorption ≤ 0.5%. Inspection booked, report attaches to the receipt.',
    referent: 'lst_902', at: '3 h ago' },
  { id: 'pst_4', type: 'result', lane: 'IN-AE', principal: 'Marina Fitout', tier: 'T2',
    title: 'Delivered — 1,800 sqm, 2 days late, accepted at agreed price',
    body: 'Late on vessel roll, not on the supplier. Recorded as delivered with a timing note.',
    referent: 'rcp_5480', at: 'yesterday' },
];

export const thread = {
  id: 'thr_1',
  us:   { name: 'Bhosale Trading', tier: 'T2' },
  them: { name: 'Al Waha Catering', tier: 'T3' },
  intents: [
    { by: 'them', kind: 'quote',   text: 'Two containers red onion, Jebel Ali, week 34. What is your price?' },
    { by: 'us',   kind: 'offer',   text: '₹22/kg FOB Nashik, moisture ≤ 12%, oven-dry at 105 °C at loading.' },
    { by: 'them', kind: 'counter', text: '₹15/kg. We have other suppliers at that level.',
      guard: { code: 'FLOOR', reason: 'price 15 below floor 18' } },
    { by: 'us',   kind: 'offer',   text: '₹20/kg, and I will carry the inspection cost.' },
  ],
};

export const escalation = {
  id: 'esc_1',
  title: 'Al Waha wants to go to ₹19/kg',
  detail: 'Your floor is ₹18. Your agent can accept this without asking — but it is within ₹1 of your floor, so it is asking.',
};
