/**
 * What changed, and whether it is still allowed — two different questions about the same terms.
 *
 * A principal says "1, 2, 3". The counterparty comes back with "1, 4, 3". The guard has nothing to
 * say about that: 4 may sit comfortably inside the mandate, so `checkMandates` allows it and the
 * deal moves. Allowed is not the same as unchanged, and a term that quietly moved between the ask
 * and the signature is exactly what a person needs shown to them.
 *
 * So there are two comparisons here and they answer different questions:
 *
 *   compareTerms(ours, theirs)      what MOVED in the negotiation
 *   compareToMandate(terms, mandate) whether it is still within what was AUTHORISED
 *
 * `review()` runs both, because either alone misleads. A change inside the mandate reads as fine
 * to the guard and may still be the whole reason to refuse. A breach with no change means the
 * mandate narrowed underneath a deal that was agreed earlier.
 *
 * Imported by BOTH the server and the browser, for the reason `shared/ranking.mjs` is: the
 * highlight a person reads must be produced by the same call that produced the verdict. Two
 * descriptions of one comparison disagree eventually, and the disagreement is invisible.
 */

const money = (p) => (p && p.amount != null ? `${p.amount} ${p.currency ?? ''}`.trim() : null);
const qty = (q) => (q && q.value != null ? `${q.value}${q.unit ?? ''}` : null);

const TIER_RANK = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 };

/** A field on the terms, how to read it, and whether a rise is good or bad for this side. */
const FIELDS = [
  { key: 'commodity', label: 'Commodity', read: (t) => t.commodity ?? null },
  { key: 'price', label: 'Price', read: (t) => money(t.price), n: (t) => t.price?.amount ?? null },
  { key: 'quantity', label: 'Quantity', read: (t) => qty(t.quantity), n: (t) => t.quantity?.value ?? null },
  { key: 'deliveryDate', label: 'Delivery', read: (t) => t.deliveryDate ?? null },
  { key: 'specTemplateId', label: 'Specification', read: (t) => t.specTemplateId ?? null },
];

/**
 * What moved between two sets of terms.
 *
 * `side` decides whether a rise is worse for this principal: a seller loses when the price falls,
 * a buyer when it rises. Reported rather than judged — "worse" is a prompt to look, not a refusal.
 */
export function compareTerms(ours, theirs, side = 'seller') {
  const lines = [];
  for (const f of FIELDS) {
    const before = f.read(ours ?? {});
    const after = f.read(theirs ?? {});
    if (before === null && after === null) continue;
    if (String(before) === String(after)) {
      lines.push({ field: f.key, label: f.label, before, after, changed: false });
      continue;
    }

    let worse = null;
    if (f.n) {
      const a = f.n(ours ?? {});
      const b = f.n(theirs ?? {});
      if (a != null && b != null && a !== b) {
        const rose = b > a;
        // Price: a seller wants it high, a buyer low. Quantity is not judged — more or less may
        // suit either side, and pretending to know would be a confident guess about their business.
        if (f.key === 'price') worse = side === 'seller' ? !rose : rose;
      }
    }
    lines.push({ field: f.key, label: f.label, before, after, changed: true, worse });
  }
  return lines;
}

/**
 * Whether each term sits inside the mandate.
 *
 * This deliberately duplicates no rule from the guard — it REPORTS, and `checkMandates` decides.
 * If the two ever disagree the guard is right and this is a display bug, which is why nothing here
 * is allowed to permit anything.
 */
export function compareToMandate(terms, mandate) {
  const lines = [];
  const t = terms ?? {};
  const m = mandate ?? {};

  if (m.commodity && t.commodity && String(m.commodity) !== String(t.commodity)) {
    lines.push({
      field: 'commodity', label: 'Commodity', within: false,
      why: `your mandate covers ${m.commodity}, these terms are for ${t.commodity}`,
    });
  }

  const price = t.price?.amount;
  const floor = m.priceFloor?.amount ?? (m.price_floor != null ? Number(m.price_floor) : null);
  const ceiling = m.priceCeiling?.amount ?? (m.price_ceiling != null ? Number(m.price_ceiling) : null);
  if (price != null && floor != null && price < floor) {
    lines.push({ field: 'price', label: 'Price', within: false,
      why: `${price} is below your floor of ${floor}` });
  }
  if (price != null && ceiling != null && price > ceiling) {
    lines.push({ field: 'price', label: 'Price', within: false,
      why: `${price} is above your ceiling of ${ceiling}` });
  }

  const q = t.quantity?.value;
  const maxQ = m.maxQuantity?.value ?? null;
  if (q != null && maxQ != null && q > maxQ) {
    lines.push({ field: 'quantity', label: 'Quantity', within: false,
      why: `${q} exceeds the ${maxQ} you allowed` });
  }

  const win = m.deliveryWindow ?? null;
  if (t.deliveryDate && win?.from && t.deliveryDate < win.from) {
    lines.push({ field: 'deliveryDate', label: 'Delivery', within: false,
      why: `${t.deliveryDate} is before your window opens on ${win.from}` });
  }
  if (t.deliveryDate && win?.to && t.deliveryDate > win.to) {
    lines.push({ field: 'deliveryDate', label: 'Delivery', within: false,
      why: `${t.deliveryDate} is after your window closes on ${win.to}` });
  }

  const min = m.counterpartyMinTier ?? m.counterparty_min_tier ?? null;
  const their = t.counterpartyTier ?? null;
  if (min && their && (TIER_RANK[their] ?? -1) < (TIER_RANK[min] ?? 0)) {
    lines.push({ field: 'counterparty', label: 'Counterparty', within: false,
      why: `they are ${their}; you asked for ${min} or better` });
  }

  return lines;
}

/**
 * Both questions at once, with a verdict a person can act on.
 *
 * `verdict` is deliberately three-valued rather than a boolean. "Nothing moved" and "something
 * moved but it is allowed" are different situations and collapsing them is how a change gets
 * approved without being seen.
 */
export function review({ ours, theirs, mandate, side = 'seller' }) {
  const changes = compareTerms(ours, theirs, side).filter((l) => l.changed);
  const breaches = compareToMandate(theirs, mandate);

  const verdict = breaches.length ? 'breaches'
    : changes.length ? 'changed'
    : 'unchanged';

  return {
    verdict,
    changes,
    breaches,
    // One line, written here so the interface and any receipt say the same words.
    summary:
      breaches.length
        ? `${breaches.length} term${breaches.length > 1 ? 's are' : ' is'} outside your mandate`
        : changes.length
          ? `${changes.length} term${changes.length > 1 ? 's' : ''} changed since your instruction`
          : 'nothing changed since your instruction',
    // What must be true before a person is asked to approve. A breach is never approvable here —
    // it goes back to the mandate, per ADR-0001.
    approvable: breaches.length === 0,
  };
}
