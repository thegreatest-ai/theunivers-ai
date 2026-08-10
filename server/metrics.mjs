/**
 * Response accounting — how many bytes we send, and how many requests we serve.
 *
 * ─── Why the app counts its own egress ───────────────────────────────────────────────────
 *
 * Fly's public GraphQL API exposes `creditBalance`, `billable` and `billingStatus` and nothing
 * else about money — there is no invoice or usage field (verified by introspecting the
 * Organization type: 35 fields, 4 billing-related, none with a number in it). Their Prometheus
 * endpoint needs org-scoped permissions a standard CLI token does not carry.
 *
 * Compute, volumes, certificates and IPs can all be priced exactly from inventory, because they
 * are fixed monthly rates for things `fly` will happily list. Egress cannot: it depends entirely
 * on traffic. It is also the ONLY line that grows with users, which makes it the one worth
 * watching and the one we would otherwise be guessing at.
 *
 * So we measure it at the origin. This slightly UNDER-reports what Fly bills, because Fly meters
 * at its edge and that includes TLS and proxy framing we never see. Treat it as a good floor,
 * not an invoice — scripts/fly-spend.mjs says so wherever it prints the number.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * Counters are batched in memory and flushed on a timer. Writing a row per request would put a
 * database write in front of every poll — and with the Bridge polling every 4 seconds (see
 * docs/KNOWN-ISSUES.md) that is precisely the write pressure that makes the missing WAL bite.
 * Monitoring must not create the load it claims to measure.
 */
import { db, run, one } from './db.mjs';

db.exec(`
  CREATE TABLE IF NOT EXISTS metric_daily (
    day        TEXT PRIMARY KEY,   -- UTC date, YYYY-MM-DD
    bytes_out  INTEGER NOT NULL DEFAULT 0,
    requests   INTEGER NOT NULL DEFAULT 0
  )`);

/** Headers are not in the body we measure. ~180 bytes is typical for our responses. */
const HEADER_ESTIMATE = 180;

const FLUSH_MS = 10_000;

let pending = { bytes: 0, requests: 0 };

const today = () => new Date().toISOString().slice(0, 10);

/** Fold the in-memory batch into today's row. Cheap, and at most once per FLUSH_MS. */
export function flush() {
  if (pending.requests === 0) return;
  const { bytes, requests } = pending;
  pending = { bytes: 0, requests: 0 };
  run(
    `INSERT INTO metric_daily (day, bytes_out, requests) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET bytes_out = bytes_out + excluded.bytes_out,
                                    requests  = requests  + excluded.requests`,
    today(), bytes, requests,
  );
}

const timer = setInterval(flush, FLUSH_MS);
timer.unref?.();                                  // never hold the process open for a counter
for (const sig of ['SIGINT', 'SIGTERM', 'beforeExit']) {
  process.once(sig, () => { try { flush(); } catch { /* shutting down anyway */ } });
}

/**
 * Wrap a response so its body length is counted exactly once, whatever path finishes it.
 * Returns the response, so callers can use it inline.
 */
export function measure(res) {
  const end = res.end.bind(res);
  let counted = false;
  res.end = (chunk, ...rest) => {
    if (!counted) {
      counted = true;
      const len = chunk == null ? 0
        : Buffer.isBuffer(chunk) ? chunk.length
        : Buffer.byteLength(String(chunk));
      pending.bytes += len + HEADER_ESTIMATE;
      pending.requests += 1;
    }
    return end(chunk, ...rest);
  };
  return res;
}

/** Daily totals, newest first. `days` is a bound, not a promise that many rows exist. */
export function daily(days = 60) {
  flush();                                        // never report a stale figure to a human
  return db.prepare(
    'SELECT day, bytes_out, requests FROM metric_daily ORDER BY day DESC LIMIT ?',
  ).all(days);
}

export function totals() {
  flush();
  const t = one('SELECT COALESCE(SUM(bytes_out),0) b, COALESCE(SUM(requests),0) r FROM metric_daily');
  const since = one('SELECT MIN(day) d FROM metric_daily');
  return { bytesOut: t?.b ?? 0, requests: t?.r ?? 0, since: since?.d ?? null };
}
