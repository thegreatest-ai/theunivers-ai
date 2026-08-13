/**
 * What the browser could not do — reported to our own server, not to a vendor.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────────────────
 *
 * On 2026-08-12 the marketing page was blank in production for ninety minutes and nothing told us.
 * The health check passed, because the API was fine. The tests passed, because they served no CSP.
 * The deploy check passed, because a blank page returns HTTP 200. The owner found it.
 *
 * The third listener below is the one that would have caught it: **the root element is still empty
 * seconds after load.** A generic error tracker sees the exception; only this sees the outcome that
 * actually mattered, and it fires even for a failure that throws nothing at all — a hung promise,
 * a preloader that never lifts, a render that silently returns null.
 *
 * ─── Why first-party ────────────────────────────────────────────────────────────────────
 *
 * A third-party SDK needs `connect-src` opened to its origin, which means **the reporter cannot
 * report a CSP failure** — the class of bug it is here for. It would also put an outside origin in
 * the critical path of a product that refuses outside origins for anything load-bearing.
 *
 * ─── What it must never do ──────────────────────────────────────────────────────────────
 *
 * Break the page it is watching. Every send is fire-and-forget, wrapped, and failure is ignored:
 * a telemetry endpoint that is down, rate-limited or blocked must be indistinguishable from one
 * that is fine. It sends no page content, no form values and no identifiers — a message, a source
 * and a path. The server attaches the session only if one already exists.
 */

const ENDPOINT = '/api/telemetry/error';

// One report per distinct message per page load. A render loop can throw the same error hundreds
// of times a second, and a reporter that faithfully forwards all of them is a denial of service
// aimed at its own operator.
const seen = new Set();

function send(kind, message, source) {
  try {
    const key = `${kind}:${String(message).slice(0, 200)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const body = JSON.stringify({
      kind,
      message: String(message ?? '').slice(0, 500),
      source: String(source ?? '').slice(0, 300),
      path: location.pathname.slice(0, 200),
      // Which build this came from, so a spike can be tied to a deploy rather than guessed at.
      build: document.querySelector('script[src*="/assets/"]')?.src?.split('/').pop() ?? '',
    });

    // sendBeacon survives the page being closed, which matters because a person looking at a blank
    // screen closes the tab. It is not available everywhere, so fetch with keepalive is the
    // fallback, and both are allowed to fail silently.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(ENDPOINT, {
        method: 'POST', body, keepalive: true,
        headers: { 'content-type': 'application/json' },
      }).catch(() => {});
    }
  } catch {
    // Never let the reporter be the thing that breaks the page.
  }
}

export function startTelemetry() {
  window.addEventListener('error', (e) => {
    // A failed <img> or <link> fires this too, with no `error` object. Those are worth knowing
    // about — a blocked asset is exactly how the last outage started.
    const msg = e?.error?.message ?? e?.message ?? 'unknown error';
    const src = e?.error?.stack?.split('\n')[1]?.trim() ?? e?.filename ?? '';
    send('error', msg, src);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    send('rejection', r?.message ?? String(r ?? 'unknown rejection'), r?.stack?.split('\n')[1]?.trim() ?? '');
  });

  /*
   * THE BLANK-PAGE DETECTOR.
   *
   * Eight seconds is chosen to be past any honest first paint on a slow connection — the preloader
   * has a six-second ceiling of its own — so an empty root here is not "still loading", it is a
   * page that never arrived. This reports the CONDITION rather than a cause, which is why it would
   * have caught an outage that produced a CSP violation, and would equally catch one that produces
   * nothing in the console at all.
   */
  setTimeout(() => {
    const root = document.getElementById('root');
    if (root && root.childElementCount === 0) {
      send('blank', 'root element still empty 8s after load', document.referrer || '');
    }
  }, 8000);
}
