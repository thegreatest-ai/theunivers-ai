/**
 * Password policy — ONE definition, imported by both the server and the browser.
 *
 * Two copies of this would drift, exactly as the mandate guard did: the form would accept what
 * the API rejects, or worse, the form would reject what the API accepts and someone would
 * "fix" the API. The client uses it for live feedback; the SERVER uses it as the actual gate.
 * Client-side validation is a courtesy — anyone can POST straight to /api/auth/register.
 */

export const RULES = [
  { id: 'length', label: '8 characters or more',        test: (p) => p.length >= 8 },
  { id: 'upper',  label: 'One capital letter (A–Z)',    test: (p) => /[A-Z]/.test(p) },
  { id: 'number', label: 'One number (0–9)',            test: (p) => /[0-9]/.test(p) },
  { id: 'symbol', label: 'One symbol (! @ # $ …)',      test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/** Which rules a candidate passes. Used live by the form, and once by the server. */
export function checkPassword(password) {
  const pw = String(password ?? '');
  const results = RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(pw) }));
  return { ok: results.every((r) => r.ok), results };
}

/** Server-side gate. Returns null when acceptable, or a human sentence when not. */
export function passwordError(password) {
  const { ok, results } = checkPassword(password);
  if (ok) return null;
  const missing = results.filter((r) => !r.ok).map((r) => r.label.toLowerCase());
  return `Password needs: ${missing.join(', ')}.`;
}
