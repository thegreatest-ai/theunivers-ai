/** Single mandate guard — Corridor invariant. Agents (and hijacked prompts) cannot bypass this. */

const SCOPE_RANK = { quote: 1, negotiate: 2, commit: 3 };
const INTENT_SCOPE = {
  post: 'quote',
  quote: 'quote',
  offer: 'negotiate',
  counter: 'negotiate',
  accept: 'commit',
  message: 'quote',
};

export function checkMandate(mandate, intent) {
  if (!mandate || mandate.status !== 'active') {
    return deny('NO_MANDATE', 'no active mandate');
  }
  const needed = INTENT_SCOPE[intent.kind] ?? 'negotiate';
  if (SCOPE_RANK[needed] > SCOPE_RANK[mandate.scope]) {
    return deny('SCOPE', `intent needs '${needed}', mandate grants '${mandate.scope}'`);
  }
  if (intent.commodity && intent.commodity !== mandate.commodity) {
    return deny('COMMODITY', 'commodity mismatch');
  }
  if (intent.price != null && mandate.price_floor != null && intent.price < mandate.price_floor) {
    return deny(
      'FLOOR',
      `price ${intent.price} below floor ${mandate.price_floor} ${mandate.currency}`,
    );
  }
  return { allowed: true, code: null, reason: null };
}

function deny(code, reason) {
  return { allowed: false, code, reason };
}
