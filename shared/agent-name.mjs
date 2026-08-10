/**
 * Agent handle rules — ONE definition, imported by both the browser and the server.
 *
 * Same reasoning as shared/password-policy.mjs: two copies drift, and the form starts accepting
 * what the API rejects. The client uses this for live feedback; the SERVER uses it as the gate,
 * because anyone can POST straight to /api/deploy.
 *
 * ─── Why a handle and not a name ─────────────────────────────────────────────────────────
 *
 * An agent handle is how one counterparty tells another apart, and it is unique across the whole
 * platform. That makes it closer to an Instagram username than to a company name: it goes in URLs,
 * in logs, in receipts, and it has to be unambiguous when read aloud or retyped from a screenshot.
 *
 * So the character set is deliberately narrow — letters, digits, dot, underscore — and the
 * structural rules below exist to close the cheap impersonation tricks that a bare character
 * whitelist still allows.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */

export const MIN = 3;
export const MAX = 30;

/** Shown next to the field, and reused in error messages. */
export const HANDLE_RULES = [
  { id: 'length',  label: `${MIN}–${MAX} characters`,          test: (h) => h.length >= MIN && h.length <= MAX },
  { id: 'charset', label: 'Letters, numbers, dots, underscores', test: (h) => /^[A-Za-z0-9._]*$/.test(h) },
  { id: 'nospace', label: 'No spaces',                          test: (h) => !/\s/.test(h) },
  { id: 'edges',   label: 'Starts and ends with a letter or number', test: (h) => /^[A-Za-z0-9].*[A-Za-z0-9]$|^[A-Za-z0-9]$/.test(h) },
  { id: 'runs',    label: 'No repeated dots or underscores',    test: (h) => !/[._]{2,}/.test(h) },
];

/**
 * The last two rules are not cosmetic, and they are stricter than Instagram on purpose.
 *
 * `edges`  — a leading or trailing dot is nearly invisible in a list, so `acme.` and `acme` read
 *            as the same handle to a human and as different ones to the database.
 * `runs`   — `acme__trading` and `acme_trading` are equally hard to tell apart at a glance.
 *
 * Uniqueness is case-insensitive at the database level (see the agent_name_unique index), so
 * `Acme` and `acme` are already one handle. These rules close the remaining look-alikes. For a
 * product whose entire claim is that you can tell who you are dealing with, a confusable handle is
 * a security problem, not a style preference.
 */

export function checkHandle(handle) {
  const h = String(handle ?? '');
  const results = HANDLE_RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(h) }));
  return { ok: results.every((r) => r.ok), results };
}

/** Server-side gate. Returns null when acceptable, or a human sentence when not. */
export function handleError(handle) {
  const h = String(handle ?? '');
  if (!h) return 'An agent name is required.';
  const { ok, results } = checkHandle(h);
  if (ok) return null;

  // Name the FIRST unmet rule rather than listing all of them. Unlike a password, where you want
  // the full checklist up front, a handle is usually wrong in exactly one way and a single
  // specific sentence is easier to act on.
  const first = results.find((r) => !r.ok);
  switch (first.id) {
    case 'length':  return `Agent name must be ${MIN}–${MAX} characters.`;
    case 'charset': return 'Agent name can use letters, numbers, dots and underscores only.';
    case 'nospace': return 'Agent name cannot contain spaces — try a dot or underscore.';
    case 'edges':   return 'Agent name must start and end with a letter or number.';
    case 'runs':    return 'Agent name cannot repeat a dot or underscore.';
    default:        return 'That agent name is not valid.';
  }
}

/**
 * Turn free text into a plausible handle. Used to suggest one when someone types a company name
 * out of habit — "Alkhwarizmi Trading" becomes "alkhwarizmi.trading" rather than being rejected
 * with nothing to do next.
 */
export function suggestHandle(text) {
  const base = String(text ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')                          // any run of other characters -> one dot
    .replace(/[._]{2,}/g, '.')
    .replace(/^[._]+|[._]+$/g, '');
  return base.slice(0, MAX);
}
