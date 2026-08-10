/**
 * Outbound mail.
 *
 * ─── The rule this file exists to enforce ────────────────────────────────────────────────
 *
 *   A reset token leaves the server ONLY inside an email.
 *
 * It used to be returned in the HTTP response body so the pilot could function without a mailer.
 * That is account takeover as an API: anyone who can POST an email address gets a token that
 * resets that account's password. The convenience is gone, permanently. If no provider is
 * configured in production, the reset silently does nothing and the caller still sees the same
 * neutral message — a broken feature, not an open door.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Providers are chosen by which credentials exist, so there is no MAIL_PROVIDER variable to get
 * wrong:
 *
 *   RESEND_API_KEY set    → Resend's HTTP API (no dependency; this file uses fetch)
 *   otherwise, dev        → log the message to stdout so local work is possible
 *   otherwise, production → refuse, and say so in the log
 *
 * Resend rather than SMTP because SMTP needs a client library and a long-lived connection, and
 * this server has no dependencies at all. Swapping in Postmark or SES means one more function
 * here and nothing anywhere else.
 */

const FROM = process.env.MAIL_FROM ?? 'theunivers.ai <onboarding@resend.dev>';
const isProd = process.env.NODE_ENV === 'production';

/** Resend's HTTP API. Returns their message id so a delivery can be traced later. */
async function viaResend({ to, subject, text, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`resend ${r.status}: ${body?.message ?? 'unknown error'}`);
  return { ok: true, provider: 'resend', id: body?.id ?? null };
}

/** Development fallback. Writes to the SERVER LOG — never to an HTTP response. */
function viaConsole({ to, subject, text }) {
  console.log(
    `\n──── mail (no provider configured; dev only) ────\n` +
    `  to:      ${to}\n  subject: ${subject}\n\n${text}\n` +
    `────────────────────────────────────────────────\n`,
  );
  return { ok: true, provider: 'console', id: null };
}

/**
 * Send one message. Never throws: a failed send must not turn into a 500 that tells the caller
 * whether an address is registered. Callers get {ok:false} and respond exactly as they would on
 * success.
 */
export async function sendMail(msg) {
  try {
    if (process.env.RESEND_API_KEY) return await viaResend(msg);
    if (!isProd) return viaConsole(msg);
    console.error('[mail] no provider configured in production — message dropped:', msg.subject);
    return { ok: false, provider: 'none', reason: 'no provider configured' };
  } catch (e) {
    console.error('[mail] send failed:', e.message);
    return { ok: false, provider: 'error', reason: e.message };
  }
}

export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY) || !isProd;
}

/* ── Messages ──────────────────────────────────────────────────────────────────────────── */

/**
 * Password reset.
 *
 * The link carries the token in a query string, which is unavoidable for a link and is why the
 * token is short-lived and single-use. Plain text is generated alongside the HTML because a
 * text/plain part materially improves deliverability and some clients show nothing else.
 */
export function resetEmail({ to, token, baseUrl }) {
  const link = `${baseUrl}/app/signin?token=${encodeURIComponent(token)}`;
  return {
    to,
    subject: 'Reset your theunivers.ai password',
    text:
      `Someone asked to reset the password for this account.\n\n` +
      `Open this link to choose a new one:\n${link}\n\n` +
      `The link works once and expires in 30 minutes.\n\n` +
      `If this wasn't you, ignore this email — nothing has changed.\n`,
    html:
      `<div style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;` +
      `max-width:520px;margin:0 auto;padding:32px 24px;color:#0b0d1b;line-height:1.6">` +
      `<h1 style="font-size:1.15rem;margin:0 0 18px;font-weight:600">Reset your password</h1>` +
      `<p style="margin:0 0 22px">Someone asked to reset the password for this account.</p>` +
      `<p style="margin:0 0 26px">` +
      `<a href="${link}" style="display:inline-block;padding:12px 22px;border-radius:10px;` +
      `background:#2e7bff;color:#fff;text-decoration:none;font-weight:500">Choose a new password</a>` +
      `</p>` +
      `<p style="margin:0 0 8px;font-size:.88rem;color:#555">` +
      `The link works once and expires in 30 minutes.</p>` +
      `<p style="margin:0;font-size:.88rem;color:#555">` +
      `If this wasn't you, ignore this email — nothing has changed.</p>` +
      `</div>`,
  };
}
